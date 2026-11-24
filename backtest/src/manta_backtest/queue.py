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
import json
import re
import subprocess
import sys
import tempfile
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


class Measure:
    """Books, hypothetical orders and samples for one series, fed normalizer records."""

    def __init__(self, sample_s: float, place_s: float) -> None:
        self.books: dict[str, dict | None] = {}  # market → {"bids": {px: sz}, "asks": …}
        self.orders: dict[str, list[tuple[str, float, Resting]]] = {}  # market → (side, px, o)
        self.results: list[dict] = []
        self.samples: list[tuple[float, float, float]] = []  # (bid size, ask size, spread)
        self.unmatched = 0.0
        self.sample_ns, self.place_ns = int(sample_s * 1e9), int(place_s * 1e9)
        self.next_sample = self.next_place = 0
        self.last = 0

    def handle(self, rec: dict) -> None:
        msg = rec["msg"]
        t = msg.get("recv_ts") or msg.get("ts")
        if self.last and t - self.last > HOLE_NS:
            self.end_all(self.last)  # a hole in the data
        self.last = max(self.last, t)
        mk = msg.get("market_id")
        if rec["type"] == "book":
            self.book(t, mk, msg)
        elif rec["type"] == "trade" and mk in self.orders:
            self.trade(t, mk, msg)
        elif rec["type"] == "status" and msg.get("state") in ("gap", "resync", "disconnected"):
            for m in [mk] if mk else list(self.books):
                self.books[m] = None  # untrusted until the next snapshot
                self.end(m, t)
        self.clock(t)

    def book(self, t: int, mk: str, msg: dict) -> None:
        if msg["kind"] == "snapshot":
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
            self.end(mk, t)  # Kalshi clears the book at the close
            return
        for side, px, o in self.orders.get(mk, []):
            if msg["kind"] == "snapshot" or (side, px) in touched:
                o.level(t, b[side].get(px, 0.0))

    def trade(self, t: int, mk: str, msg: dict) -> None:
        px, sz = float(msg["px"]), float(msg["sz"])
        hits = {"sell": "bids", "buy": "asks"}.get(msg["side"])  # taker sells into the bids
        for side, opx, o in self.orders[mk]:
            if side != hits:
                continue
            if px == opx:
                o.trade(t, sz)
            elif (side == "bids" and px < opx) or (side == "asks" and px > opx):
                o.trade(t, sz, through=True)

    def clock(self, t: int) -> None:
        if t < self.next_sample:
            return
        horizon = max(HORIZONS_S) * 1_000_000_000 + MATCH_NS
        for mk in list(self.orders):
            done = [x for x in self.orders[mk] if t - x[2].t0 > horizon]
            for x in done:
                self.finish(x, t)
                self.orders[mk].remove(x)
        place = t >= self.next_place
        for mk, b in self.books.items():
            top = active(b)
            if not top:
                continue
            bid, bsz, ask, asz = top
            self.samples.append((bsz, asz, ask - bid))
            if place:
                self.orders.setdefault(mk, []).extend(
                    [("bids", bid, Resting(t, bsz)), ("asks", ask, Resting(t, asz))]
                )
        self.next_sample = t + self.sample_ns
        if place:
            self.next_place = t + self.place_ns

    def finish(self, x: tuple[str, float, Resting], end: int) -> None:
        side, px, o = x
        o.expire(end + MATCH_NS + 1)  # settle what is still waiting to be matched
        self.unmatched += o.unmatched_trades
        self.results.append({"side": side, "ahead": o.ahead0, "out": outcome(o, end)})

    def end(self, mk: str, t: int) -> None:
        for x in self.orders.pop(mk, []):
            self.finish(x, t)

    def end_all(self, t: int) -> None:
        for mk in list(self.orders):
            self.end(mk, t)


def active(b: dict | None) -> tuple[float, float, float, float] | None:
    """Best bid, its size, best ask, its size, for a contract quoted on both sides with its
    midpoint between 5c and 95c (far strikes pinned at 1c/99c would drown every statistic)."""
    if not b or not b["bids"] or not b["asks"]:
        return None
    bid, ask = max(b["bids"]), min(b["asks"])
    if not 0.05 <= (bid + ask) / 2 <= 0.95:
        return None
    return bid, b["bids"][bid], ask, b["asks"][ask]


def run(files: list[str], series: str, sample_s: float, place_s: float) -> tuple[Measure, dict]:
    """Feed every stretch of files through the normalizer into one Measure; also count every
    series' trades (for choosing a family)."""
    meas = Measure(sample_s, place_s)
    trades: dict[str, list[float]] = {}  # series → [trades, contracts, dollars]
    key = f'"market_id":"{series}-'
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
            for line in proc.stdout:
                is_trade = line.endswith('"type":"trade"}\n')
                if key not in line and not is_trade and '"type":"status"' not in line:
                    continue
                rec = json.loads(line)
                if is_trade:
                    m = rec["msg"]
                    row = trades.setdefault(m["market_id"].split("-", 1)[0], [0, 0.0, 0.0])
                    row[0] += 1
                    row[1] += float(m["sz"])
                    row[2] += float(m["sz"]) * float(m["px"])
                    if key not in line:
                        continue
                meas.handle(rec)
            if proc.wait() != 0:
                sys.exit("normalize failed")
            meas.end_all(meas.last)
            meas.last = 0
    return meas, trades


def report(meas: Measure, trades: dict, hours: float) -> str:
    out = []
    bs = [min(b, a) for b, a, _ in meas.samples]
    spreads = [s for _, _, s in meas.samples]
    one_c = sum(s <= 0.0101 for s in spreads) / max(len(spreads), 1)
    q = quantiles(bs, n=4) if len(bs) > 1 else [0, 0, 0]
    out.append(
        f"Queue at the best price (smaller side), {len(bs):,} samples: "
        f"quartiles {q[0]:,.0f} / {q[1]:,.0f} / {q[2]:,.0f} contracts; 1c spread {one_c:.1%}"
    )
    out.append(
        f"Orders followed: {len(meas.results):,}; trade volume never matched to a size drop: "
        f"{meas.unmatched:,.0f} contracts"
    )
    for q_size in SIZES:
        out.append(f"\nFilled in full, order of {q_size} (share of uncensored orders, n):")
        out.append(
            "queue ahead      | " + " | ".join(f"{h}s {m}" for h in HORIZONS_S for m in MODELS)
        )
        groups: dict[str, list] = {"all": meas.results}
        for r in meas.results:
            groups.setdefault(bucket(r["ahead"]), []).append(r)
        for g in ["all"] + [bucket(x - 1) for x in QUEUE_BUCKETS] + [bucket(QUEUE_BUCKETS[-1])]:
            rows = groups.get(g, [])
            cells = []
            for h in HORIZONS_S:
                for m in MODELS:
                    v = [r["out"][(h, m, q_size)] for r in rows]
                    v = [x for x in v if x is not None]
                    cells.append(f"{sum(v) / len(v):5.1%} ({len(v)})" if v else "-")
            out.append(f"{g:16} | " + " | ".join(cells))
    out.append(f"\nTrades per hour by series ({hours:g} h):")
    for s, (n, c, d) in sorted(trades.items(), key=lambda kv: -kv[1][2]):
        out.append(
            f"  {s:14} {n / hours:8,.0f} trades  {c / hours:12,.0f} contracts  ${d / hours:12,.0f}"
        )
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="+", help="raw Kalshi hourly files")
    ap.add_argument("--series", default="KXBTCD")
    ap.add_argument("--sample", type=float, default=10, help="seconds between queue samples")
    ap.add_argument("--place", type=float, default=60, help="seconds between hypothetical orders")
    a = ap.parse_args()
    meas, trades = run(a.files, a.series, a.sample, a.place)
    print(report(meas, trades, len(a.files)))


if __name__ == "__main__":
    main()
