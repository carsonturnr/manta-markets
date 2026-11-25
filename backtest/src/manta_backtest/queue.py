"""Market maker, measurement 1: how much stands ahead of a new order at the best price, and how
often such an order would have been filled (docs/plan-market-maker.md).

    uv run manta-queue --series KXBTCD ../data/raw/kalshi/2026-11-23/{13,14}-0000.jsonl.gz

Terms:
- best bid / best ask: the highest price someone will buy at / the lowest someone will sell at.
- queue: the contracts already resting at one price. Kalshi fills them first come, first served,
  so a new order joins the back and waits until everything ahead of it has traded or cancelled.
- fill: our resting order trades with someone who crosses the spread (a "taker").

Every `--place` seconds of recorded time, a hypothetical order is placed at the best bid and at
the best ask of every active contract (quoted on both sides, midpoint 5-95c, as the liquidity
page counts them), at the back of the queue. It never changes the recorded market (it is assumed
small). We then follow the recorded trades and book changes at its price:

- trades at its price use up the queue ahead of it, then fill it;
- a trade at a worse price (a seller selling below our bid) means the book traded through our
  price, which would have filled us;
- the book only shows each price's total size, not who cancelled, so a cancellation is split
  between "ahead of us" and "behind us" three ways: all behind (pessimistic, the usual safe
  choice), in proportion to sizes, or all ahead (optimistic). The truth lies between the first
  and the last.

Kalshi sends trades and book changes as separate messages and their arrival order varies
(measured 2026-11-23 on KXBTCD: the book change arrived first for 58% of trades, though Kalshi's
own timestamps agree to the millisecond for 82%). So a size drop at our price is held for
`MATCH_NS` and matched against trades at that price before it counts as a cancellation.

An order is followed until its longest horizon, its market closes or gaps, or the data stops
(then later horizons are "censored": left out of the share, not counted as unfilled).
"""

import argparse
import heapq
import json
import re
import subprocess
import sys
import tempfile
from collections import deque
from datetime import UTC, datetime, timedelta
from pathlib import Path
from statistics import quantiles

from manta_backtest.catalog import build_tools

MODELS = ("behind", "proportional", "ahead")  # where cancellations are assumed to come from
SIZES = (1, 100)  # order sizes in contracts: is 1 filled, is 100 filled in full
HORIZONS_S = (10, 60, 300)
MATCH_NS = 1_000_000_000  # trade ↔ size-drop matching window
HOLE_NS = 5_000_000_000  # no record for this long: the data has a hole
QUEUE_BUCKETS = (100, 1_000, 10_000)  # contracts ahead at placement


class Resting:
    """A hypothetical order resting at one price, joined at the back of its queue."""

    def __init__(self, t0: int, ahead: float) -> None:
        self.t0 = t0
        self.ahead0 = ahead
        self.shown = ahead  # the recorded size at our price (not counting us)
        self.ahead = dict.fromkeys(MODELS, ahead)
        self.behind = dict.fromkeys(MODELS, 0.0)
        self.past = dict.fromkeys(MODELS, 0.0)  # traded volume that reached us
        self.fill_at: dict[tuple[str, int], int] = {}  # (model, size) → time of full fill
        self.drops: list[list[float]] = []  # [time, size] size drops not yet matched to a trade
        self.credit: list[list[float]] = []  # [time, size] trades not yet matched to a drop
        self.unmatched_trades = 0.0  # trade volume whose size drop never arrived

    def level(self, t: int, size: float) -> None:
        """The recorded size at our price is now `size`."""
        self.expire(t)
        change, self.shown = size - self.shown, size
        if change > 0:  # new orders join behind us
            for m in MODELS:
                self.behind[m] += change
        elif change < 0:
            rest = _take(self.credit, -change)  # the drop of a trade we already applied
            if rest > 0:
                self.drops.append([t, rest])
        self._resync()

    def trade(self, t: int, size: float, through: bool = False) -> None:
        """A taker traded `size` at our price (or, `through`, at a worse one)."""
        self.expire(t)
        if through:  # our price was emptied, us included
            for m in MODELS:
                self.past[m] += size
        else:
            rest = _take(self.drops, size)  # the size drop arrived first
            if rest > 0:
                self.credit.append([t, rest])
            for m in MODELS:
                took = min(self.ahead[m], size)
                self.ahead[m] -= took
                self.past[m] += size - took
                self.behind[m] = max(0.0, self.behind[m] - (size - took))
        for m in MODELS:
            for q in SIZES:
                if self.past[m] >= q:
                    self.fill_at.setdefault((m, q), t)

    def expire(self, t: int) -> None:
        """Size drops no trade explained within MATCH_NS are cancellations."""
        while self.drops and t - self.drops[0][0] > MATCH_NS:
            self._cancel(self.drops.pop(0)[1])
        while self.credit and t - self.credit[0][0] > MATCH_NS:
            self.unmatched_trades += self.credit.pop(0)[1]
        self._resync()

    def _cancel(self, c: float) -> None:
        a, b = self.ahead["behind"], self.behind["behind"]
        from_b = min(b, c)
        self.ahead["behind"], self.behind["behind"] = max(0.0, a - (c - from_b)), b - from_b
        a, b = self.ahead["ahead"], self.behind["ahead"]
        from_a = min(a, c)
        self.ahead["ahead"], self.behind["ahead"] = a - from_a, max(0.0, b - (c - from_a))
        a, b = self.ahead["proportional"], self.behind["proportional"]
        share = c * a / (a + b) if a + b > 0 else 0.0
        self.ahead["proportional"] = max(0.0, a - share)
        self.behind["proportional"] = max(0.0, b - (c - share))

    def _resync(self) -> None:
        # With nothing waiting to be matched, ahead + behind must equal what the book shows.
        if self.drops or self.credit:
            return
        for m in MODELS:
            self.ahead[m] = min(self.ahead[m], self.shown)
            self.behind[m] = self.shown - self.ahead[m]


def _take(queue: list[list[float]], size: float) -> float:
    """Use up to `size` from the oldest entries of `queue`; return what was left over."""
    while size > 0 and queue:
        used = min(queue[0][1], size)
        queue[0][1] -= used
        size -= used
        if queue[0][1] <= 1e-9:
            queue.pop(0)
    return size


def outcome(order: Resting, end: int) -> dict:
    """Per horizon, model and size: True (filled in time), False, or None (censored)."""
    out = {}
    for h in HORIZONS_S:
        for m in MODELS:
            for q in SIZES:
                at = order.fill_at.get((m, q))
                if at is not None and at - order.t0 <= h * 1e9:
                    out[(h, m, q)] = True
                elif end - order.t0 >= h * 1e9:
                    out[(h, m, q)] = False
                else:
                    out[(h, m, q)] = None
    return out


def bucket(ahead: float) -> str:
    lo = 0
    for hi in QUEUE_BUCKETS:
        if ahead < hi:
            return f"{lo:,}-{hi:,}"
        lo = hi
    return f"{lo:,}+"


def stretches(files: list[str]) -> list[list[str]]:
    """Split hourly files (…/YYYY-MM-DD/HH-MMSS.jsonl.gz) into runs of consecutive hours: the
    normalizer must see a continuous feed, so each run gets its own."""
    runs: list[list[str]] = []
    prev = None
    for f in sorted(files):
        m = re.search(r"(\d{4})-(\d\d)-(\d\d)/(\d\d)-\d{4}\.jsonl\.gz$", f)
        if not m:
            sys.exit(f"not a recorder file name: {f}")
        hour = datetime(*map(int, m.groups()), tzinfo=UTC)
        if prev is None or hour - prev > timedelta(hours=1):
            runs.append([])
        runs[-1].append(f)
        prev = hour
    return runs


def day_type(t: int, volatile: list[tuple[int, int]]) -> str:
    """Which kind of session a moment belongs to: a chosen volatile window, the weekend (UTC),
    weekday US stock-market hours (9:30-16:00 New York), or weekday off-hours."""
    if any(a <= t < b for a, b in volatile):
        return "volatile"
    d = datetime.fromtimestamp(t / 1e9, UTC)
    if d.weekday() >= 5:
        return "weekend"
    minute = d.hour * 60 + d.minute
    # shortcut: New York on standard time (UTC-5); recheck before using data from 2027-03-14 on.
    return "us-hours" if 14 * 60 + 30 <= minute < 21 * 60 else "off-hours"


def mid(b: dict | None) -> float | None:
    if not b or not b["bids"] or not b["asks"]:
        return None
    return (max(b["bids"]) + min(b["asks"])) / 2


class Measure:
    """Books, hypothetical orders, samples and markouts for one series, fed normalizer records.

    Everything is kept as totals keyed by strings ("us-hours|60|behind|1"), so days measured in
    separate processes add up (`merge`).

    Markout: what a maker's trade was worth some time later, per contract, against the mid then.
    A maker who bought at price p made (mid later - p); one who sold made (p - mid later). It is
    split into spread earned (mid at the trade - p, for a buy) and adverse selection (mid later -
    mid at the trade): the first is what the maker was paid to trade, the second what the price
    then did to them. Kinds: "trades" (every recorded trade, from the side of the resting order
    it hit; needs no queue model) and "fills-<model>" (our hypothetical orders' first fills).
    """

    def __init__(self, sample_s: float, place_s: float, volatile=(), mids: bool = False) -> None:
        self.books: dict[str, dict | None] = {}  # market → {"bids": {px: sz}, "asks": …}
        self.orders: dict[str, list[tuple[str, float, Resting]]] = {}  # market → (side, px, o)
        self.volatile = list(volatile)
        self.agg: dict[str, dict] = {
            "queue": {},  # day type → smaller best-price size of each sample
            "one_cent": {},  # day type → [samples at a 1c spread, samples]
            "fills": {},  # "day|bucket|h|model|size" → [filled, orders]
            "marks": {},  # "kind|day|h" → [n, Σw, Σw², Σw·x, Σw·x², Σw·spread] (x in dollars)
            "censored": {},  # "kind|h" → markouts with no mid at the horizon
            "at_close": {},  # "kind|h" → markouts valued at the last mid before the close
            "unmatched": 0.0,
        }
        self.pending: list[tuple] = []  # heap of markouts waiting for their horizon
        self.closed: dict[str, tuple[int, float | None]] = {}  # market → (close time, last mid)
        self.seq = 0
        self.grid: dict[str, tuple[list[int], list[float]]] | None = {} if mids else None
        self.sample_ns, self.place_ns = int(sample_s * 1e9), int(place_s * 1e9)
        self.next_sample = self.next_place = self.next_grid = 0
        self.watch: list[str] = []  # active at the last sample: the markets the mid grid follows
        self.history: dict[str, deque] = {}  # watched market → recent (time, mid)

    def handle(self, rec: dict) -> None:
        msg = rec["msg"]
        t = msg.get("recv_ts") or msg.get("ts")
        self.resolve(t)  # horizons that passed before this record: the book as it stood
        mk = msg.get("market_id")
        if rec["type"] == "book":
            self.book(t, mk, msg)
        elif rec["type"] == "trade":
            self.trade(t, mk, msg)
        elif rec["type"] == "status" and msg.get("state") in ("gap", "resync", "disconnected"):
            for m in [mk] if mk else list(self.books):
                self.books[m] = None  # untrusted until the next snapshot
                self.end(m, t)
        self.clock(t)

    def book(self, t: int, mk: str, msg: dict) -> None:
        if msg["kind"] == "snapshot":
            old = self.books.get(mk)
            b = {"bids": {}, "asks": {}}
            self.books[mk] = b
        else:
            b = self.books.get(mk)
            if b is None:
                return  # no snapshot yet
        touched = set()
        for side in ("bids", "asks"):
            for px, sz in msg[side]:
                p, s = float(px), float(sz)
                if s > 0:
                    b[side][p] = s
                else:
                    b[side].pop(p, None)
                touched.add((side, p))
        if msg["kind"] == "snapshot" and not b["bids"] and not b["asks"]:
            self.closed[mk] = (t, mid(old))  # Kalshi clears the book at the close
            self.end(mk, t)
            return
        for side, px, o in self.orders.get(mk, []):
            if msg["kind"] == "snapshot" or (side, px) in touched:
                o.level(t, b[side].get(px, 0.0))
        h = self.history.get(mk)
        if h is not None and (m := mid(b)) is not None and (not h or h[-1][1] != m):
            h.append((t, m))
            while len(h) > 1 and h[1][0] <= t - 2 * MATCH_NS:
                h.popleft()  # keep the last mid older than 2 s, and everything since

    def mid_before(self, mk: str, t: int) -> float | None:
        """The mid MATCH_NS before t: before the trade's own book change, which may arrive
        first. Falls back to the current mid for a market not followed yet."""
        h = self.history.get(mk)
        at = None
        for ts, m in h or ():
            if ts > t - MATCH_NS:
                break
            at = m
        return at if at is not None else mid(self.books.get(mk))

    def trade(self, t: int, mk: str, msg: dict) -> None:
        px, sz = float(msg["px"]), float(msg["sz"])
        hits = {"sell": "bids", "buy": "asks"}.get(msg["side"])  # taker sells into the bids
        if hits is None:
            return
        m0 = self.mid_before(mk, t)
        if m0 is not None and 0.05 <= m0 <= 0.95:
            self.mark(t, mk, "trades", 1 if hits == "bids" else -1, px, sz, m0)
        for side, opx, o in self.orders.get(mk, []):
            if side != hits:
                continue
            before = {m: (m, 1) in o.fill_at for m in MODELS}
            if px == opx:
                o.trade(t, sz)
            elif (side == "bids" and px < opx) or (side == "asks" and px > opx):
                o.trade(t, sz, through=True)
            for m in ("behind", "ahead"):
                if not before[m] and (m, 1) in o.fill_at and m0 is not None:
                    self.mark(t, mk, f"fills-{m}", 1 if side == "bids" else -1, opx, 1.0, m0)

    def mark(self, t: int, mk: str, kind: str, sign: int, px: float, w: float, m0: float):
        """Schedule a markout: a maker bought (sign 1) or sold (-1) w contracts at px."""
        dt = day_type(t, self.volatile)
        for h in HORIZONS_S:
            self.seq += 1
            heapq.heappush(
                self.pending, (t + h * 1_000_000_000, self.seq, mk, kind, dt, h, sign, px, w, m0)
            )

    def resolve(self, t: int) -> None:
        while self.pending and self.pending[0][0] <= t:
            due, _, mk, kind, dt, h, sign, px, w, m0 = heapq.heappop(self.pending)
            closed = self.closed.get(mk)
            if closed and closed[0] <= due:
                later = closed[1]
                _add(self.agg["at_close"], f"{kind}|{h}", 1)
            else:
                later = mid(self.books.get(mk))
            if later is None:
                _add(self.agg["censored"], f"{kind}|{h}", 1)
                continue
            x, spread = sign * (later - px), sign * (m0 - px)
            acc = self.agg["marks"].setdefault(f"{kind}|{dt}|{h}", [0, 0.0, 0.0, 0.0, 0.0, 0.0])
            for i, v in enumerate((1, w, w * w, w * x, w * x * x, w * spread)):
                acc[i] += v

    def clock(self, t: int) -> None:
        if self.grid is not None and t >= self.next_grid:
            sec = t // 1_000_000_000
            for mk in self.watch:
                m = mid(self.books.get(mk))
                if m is not None:
                    secs, mids = self.grid.setdefault(mk, ([], []))
                    secs.append(sec)
                    mids.append(m)
            self.next_grid = (sec + 1) * 1_000_000_000
        if t < self.next_sample:
            return
        horizon = max(HORIZONS_S) * 1_000_000_000 + MATCH_NS
        for mk in list(self.orders):
            done = [x for x in self.orders[mk] if t - x[2].t0 > horizon]
            for x in done:
                self.finish(x, t)
                self.orders[mk].remove(x)
        place = t >= self.next_place
        dt = day_type(t, self.volatile)
        self.watch = []
        for mk, b in self.books.items():
            top = active(b)
            if not top:
                continue
            self.watch.append(mk)
            bid, bsz, ask, asz = top
            self.history.setdefault(mk, deque([(t, (bid + ask) / 2)]))
            self.agg["queue"].setdefault(dt, []).append(min(bsz, asz))
            one = self.agg["one_cent"].setdefault(dt, [0, 0])
            one[0] += ask - bid <= 0.0101
            one[1] += 1
            if place:
                self.orders.setdefault(mk, []).extend(
                    [("bids", bid, Resting(t, bsz)), ("asks", ask, Resting(t, asz))]
                )
        self.next_sample = t + self.sample_ns
        if place:
            self.next_place = t + self.place_ns

    def finish(self, x: tuple[str, float, Resting], end: int) -> None:
        _, _, o = x
        o.expire(end + MATCH_NS + 1)  # settle what is still waiting to be matched
        self.agg["unmatched"] += o.unmatched_trades
        dt, b = day_type(o.t0, self.volatile), bucket(o.ahead0)
        for (h, m, q), filled in outcome(o, end).items():
            if filled is not None:
                acc = self.agg["fills"].setdefault(f"{dt}|{b}|{h}|{m}|{q}", [0, 0])
                acc[0] += filled
                acc[1] += 1

    def end(self, mk: str, t: int) -> None:
        for x in self.orders.pop(mk, []):
            self.finish(x, t)

    def stop(self, t: int) -> None:
        """The data stops (a hole or the end of a stretch): close every order, and drop markouts
        still waiting, since the mid after a hole is not the mid at their horizon."""
        for mk in list(self.orders):
            self.end(mk, t)
        for p in self.pending:
            _add(self.agg["censored"], f"{p[3]}|{p[5]}", 1)
        self.pending = []
        self.watch = []


def _add(d: dict, key: str, v: float) -> None:
    d[key] = d.get(key, 0) + v


def active(b: dict | None) -> tuple[float, float, float, float] | None:
    """Best bid, its size, best ask, its size, for a contract quoted on both sides with its
    midpoint between 5c and 95c (far strikes pinned at 1c/99c would drown every statistic)."""
    if not b or not b["bids"] or not b["asks"]:
        return None
    bid, ask = max(b["bids"]), min(b["asks"])
    if not 0.05 <= (bid + ask) / 2 <= 0.95:
        return None
    return bid, b["bids"][bid], ask, b["asks"][ask]


def run(
    files: list[str], series: list[str], sample_s: float, place_s: float, volatile=(), mids=()
) -> dict:
    """Feed every stretch of files through the normalizer, one Measure per series; also count
    every series' trades (for choosing a family). Returns totals that `merge` can add up."""
    meas = {s: Measure(sample_s, place_s, volatile, s in mids) for s in series}
    keys = tuple(f'"market_id":"{s}-' for s in series)
    trades: dict[str, list[float]] = {}  # series → [trades, contracts, dollars]
    with tempfile.TemporaryDirectory() as tmp:
        _, normalize = build_tools(Path(tmp))
        for stretch in stretches(files):
            proc = subprocess.Popen(
                [normalize, "-venue", "kalshi", *stretch],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            assert proc.stdout
            last = 0
            for line in proc.stdout:
                is_trade = line.endswith('"type":"trade"}\n')
                ours = any(k in line for k in keys)
                if not ours and not is_trade and '"type":"status"' not in line:
                    continue
                rec = json.loads(line)
                t = rec["msg"].get("recv_ts") or rec["msg"].get("ts")
                if last and t - last > HOLE_NS:
                    for m in meas.values():
                        m.stop(last)  # a hole in the data
                last = max(last, t)
                mk = rec["msg"].get("market_id")
                if is_trade:
                    m = rec["msg"]
                    row = trades.setdefault(mk.split("-", 1)[0], [0, 0.0, 0.0])
                    row[0] += 1
                    row[1] += float(m["sz"])
                    row[2] += float(m["sz"]) * float(m["px"])
                if mk is None:  # a venue-wide status
                    for m in meas.values():
                        m.handle(rec)
                elif ours:
                    meas[mk.split("-", 1)[0]].handle(rec)
            if proc.wait() != 0:
                sys.exit("normalize failed")
            for m in meas.values():
                m.stop(last)
    return {
        "hours": len(files),
        "trades": trades,
        "series": {s: m.agg for s, m in meas.items()},
        "grids": {s: m.grid for s, m in meas.items() if m.grid},
    }


def merge(parts: list[dict]) -> dict:
    """Add up the totals of several runs (one per day)."""

    def plus(a: list | None, b: list) -> list:
        return list(b) if a is None else [x + y for x, y in zip(a, b, strict=True)]

    out: dict = {"hours": 0, "trades": {}, "series": {}}
    for p in parts:
        out["hours"] += p["hours"]
        for s, row in p["trades"].items():
            out["trades"][s] = plus(out["trades"].get(s), row)
        for s, agg in p["series"].items():
            o = out["series"].setdefault(
                s,
                {k: {} for k in ("queue", "one_cent", "fills", "marks", "censored", "at_close")}
                | {"unmatched": 0.0},
            )
            o["unmatched"] += agg["unmatched"]
            for dt, v in agg["queue"].items():
                o["queue"].setdefault(dt, []).extend(v)  # samples are joined
            for name in ("one_cent", "fills", "marks"):
                for k, v in agg[name].items():
                    o[name][k] = plus(o[name].get(k), v)
            for name in ("censored", "at_close"):
                for k, v in agg[name].items():
                    o[name][k] = o[name].get(k, 0) + v
    return out


def fill_share(agg: dict, dt: str, b: str | None, h: int, m: str, q: int) -> tuple[int, int]:
    """[filled, orders] for a day type ("pooled": all) and queue bucket (None: all)."""
    f = n = 0
    for k, (ff, nn) in agg["fills"].items():
        kd, kb, kh, km, kq = k.split("|")
        if dt in ("pooled", kd) and b in (None, kb) and (kh, km, kq) == (str(h), m, str(q)):
            f, n = f + ff, n + nn
    return f, n


DAY_TYPES = ("us-hours", "off-hours", "weekend", "volatile")


def mean_se(acc: list[float]) -> tuple[float, float, float]:
    """Weighted mean of x, its standard error (from the effective sample size (Σw)²/Σw²), and
    the weighted mean of the spread part. Inputs as kept in Measure.agg["marks"]."""
    n, w, w2, wx, wx2, ws = acc
    m = wx / w
    var = max(wx2 / w - m * m, 0.0)
    n_eff = w * w / w2
    return m, (var / n_eff) ** 0.5 if n_eff > 1 else float("nan"), ws / w


def report(data: dict) -> str:
    out = []
    hours = data["hours"]
    for s, agg in data["series"].items():
        out.append(f"\n## {s}\n")
        out.append("Queue at the best price (smaller side), by day type:")
        out.append("| Day type | Samples | Quartiles (contracts) | 1c spread |")
        out.append("|---|---|---|---|")
        for dt in (*DAY_TYPES, "pooled"):
            if dt == "pooled":
                v = [x for d in agg["queue"].values() for x in d]
                one = [sum(x[i] for x in agg["one_cent"].values()) for i in (0, 1)]
            else:
                v, one = agg["queue"].get(dt, []), agg["one_cent"].get(dt, [0, 0])
            if len(v) < 2:
                continue
            q = quantiles(v, n=4)
            out.append(
                f"| {dt} | {len(v):,} | {q[0]:,.0f} / {q[1]:,.0f} / {q[2]:,.0f} | "
                f"{one[0] / one[1]:.1%} |"
            )
        out.append(
            f"\nFill likelihood, order joining the back at the best price (pessimistic-optimistic; "
            f"trades never matched to a size drop: {agg['unmatched']:,.0f} contracts):"
        )
        out.append(
            "| Day type / queue ahead | Orders | 1 ct 10 s | 1 ct 60 s | 1 ct 5 min | 100 ct 60 s |"
        )
        out.append("|---|---|---|---|---|---|")
        rows = [(dt, None) for dt in (*DAY_TYPES, "pooled")]
        rows += [("pooled", bucket(x - 1)) for x in QUEUE_BUCKETS] + [
            ("pooled", bucket(QUEUE_BUCKETS[-1]))
        ]
        for dt, b in rows:
            if fill_share(agg, dt, b, 10, "behind", 1)[1] == 0:
                continue
            cells = []
            for h, q in ((10, 1), (60, 1), (300, 1), (60, 100)):
                lo, n = fill_share(agg, dt, b, h, "behind", q)
                hi, n2 = fill_share(agg, dt, b, h, "ahead", q)
                cells.append(f"{lo / n:.1%}-{hi / n2:.1%}")
            label = dt if b is None else f"pooled, {b} ahead"
            out.append(
                f"| {label} | {fill_share(agg, dt, b, 10, 'behind', 1)[1]:,} | "
                + " | ".join(cells)
                + " |"
            )
        out.append(
            "\nMarkouts, cents per contract from the maker's side (total = spread + adverse; "
            "± 2 standard errors):"
        )
        out.append("| Kind | Day type | Horizon | n | Spread earned | Adverse selection | Total |")
        out.append("|---|---|---|---|---|---|---|")
        kinds = sorted({k.split("|")[0] for k in agg["marks"]})
        for kind in kinds:
            for dt in (*DAY_TYPES, "pooled"):
                for h in HORIZONS_S:
                    accs = [
                        v
                        for k, v in agg["marks"].items()
                        if k.split("|")[0] == kind
                        and dt in ("pooled", k.split("|")[1])
                        and k.split("|")[2] == str(h)
                    ]
                    if not accs:
                        continue
                    acc = [sum(a[i] for a in accs) for i in range(6)]
                    if acc[0] < 2:
                        continue
                    m, se, sp = mean_se(acc)
                    out.append(
                        f"| {kind} | {dt} | {h} s | {acc[0]:,} | {100 * sp:+.2f} | "
                        f"{100 * (m - sp):+.2f} | {100 * m:+.2f} ± {200 * se:.2f} |"
                    )
        cens = ", ".join(f"{k} {v:,}" for k, v in sorted(agg["censored"].items()))
        close = ", ".join(f"{k} {v:,}" for k, v in sorted(agg["at_close"].items()))
        out.append(
            f"\nCensored (no mid): {cens or 'none'}. Valued at the close: {close or 'none'}."
        )
    out.append(f"\nTrades per hour by series ({hours:g} h):")
    for s, (n, c, d) in sorted(data["trades"].items(), key=lambda kv: -kv[1][2]):
        out.append(
            f"  {s:14} {n / hours:8,.0f} trades  {c / hours:12,.0f} contracts  ${d / hours:12,.0f}"
        )
    return "\n".join(out)


def window(text: str) -> tuple[int, int]:
    """'2026-11-19T13:00/2026-11-19T18:00' (UTC) → (start, end) in ns."""
    a, b = text.split("/")
    return tuple(
        int(datetime.fromisoformat(x).replace(tzinfo=UTC).timestamp() * 1e9) for x in (a, b)
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="+", help="raw Kalshi hourly files")
    ap.add_argument("--series", default="KXBTCD", help="comma-separated")
    ap.add_argument("--sample", type=float, default=10, help="seconds between queue samples")
    ap.add_argument("--place", type=float, default=60, help="seconds between hypothetical orders")
    ap.add_argument("--volatile", action="append", default=[], help="UTC window START/END")
    ap.add_argument("--out", type=Path, help="write the totals as JSON (for manta-queue-report)")
    ap.add_argument("--mids", type=Path, help="write KXBTCD's 1 s mid grid as Parquet")
    a = ap.parse_args()
    data = run(
        a.files,
        a.series.split(","),
        a.sample,
        a.place,
        [window(v) for v in a.volatile],
        ("KXBTCD",) if a.mids else (),
    )
    grids = data.pop("grids")
    if a.mids:
        import pyarrow as pa
        import pyarrow.parquet as pq

        cols: dict[str, list] = {"ticker": [], "sec": [], "mid": []}
        for g in grids.values():
            for mk, (secs, mids) in g.items():
                cols["ticker"] += [mk] * len(secs)
                cols["sec"] += secs
                cols["mid"] += mids
        pq.write_table(pa.table(cols), a.mids)
    if a.out:
        a.out.write_text(json.dumps(data))
    print(report(data))


def report_main() -> None:
    ap = argparse.ArgumentParser(description="Add up manta-queue --out files and print them.")
    ap.add_argument("files", nargs="+", type=Path)
    a = ap.parse_args()
    print(report(merge([json.loads(f.read_text()) for f in a.files])))


if __name__ == "__main__":
    main()
