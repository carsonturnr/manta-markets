"""Market maker on NautilusTrader: the replay runner and the strategies (docs/plan-market-maker.md,
sub-steps 5-6).

    uv run manta-mm-probe --catalog DIR --markets markets.jsonl.gz [--no-reorder]

The venue is Nautilus's simulated exchange on L2 books (size per price, all Kalshi publishes) with
`queue_position` on: an order joins behind the size already at its price, trades at that price
use up the queue ahead of it, and a level that shrinks below that queue caps it (checked on
hand-made books, 2026-11-25: the same fills as manta-queue's pessimistic model). Orders are
post-only, so every fill is a maker fill; makers pay no fee on KXBTCD or KXBTC15M, so the venue
has a zero fee model and fees are worked out in manta_backtest.mm.

Data is fed an hour at a time (a busy hour of KXBTCD is about 7 million book changes), with each
trade moved ahead of the size drop it caused (mm.trades_first): see that function for why.
"""

import argparse
import bisect
import heapq
import json
import tempfile
import urllib.request
from decimal import Decimal
from pathlib import Path

import pyarrow.parquet as pq
from manta_pricing.table import ts as iso_s
from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel, StaticLatencyModel
from nautilus_trader.model import (
    AccountType,
    BookType,
    Currency,
    InstrumentId,
    Money,
    NautilusDataType,
    OmsType,
    OrderSide,
    Price,
    Quantity,
    Venue,
)
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.risk import RiskEngineConfig
from nautilus_trader.trading import Strategy

from manta_backtest.catalog import build_tools
from manta_backtest.fairseries import markets
from manta_backtest.mm import Fill, kalshi_fee, split, trades_first
from manta_backtest.queue import HORIZONS_S, bucket

HOUR = 3600 * 1_000_000_000
S = 1_000_000_000


def replay(
    catalog: Path,
    strategy: Strategy,
    latency_ns: int = 0,
    reorder: bool = True,
    trade_execution: bool = True,
    series: set[str] | None = None,
    risk: RiskEngineConfig | None = None,
) -> None:
    """Run `strategy` over the contracts of `series` (all if None) in `catalog`, an hour at a
    time."""
    cat = ParquetDataCatalog(str(catalog))
    insts = [
        i for i in cat.instruments() if not series or i.id.symbol.value.split("-")[0] in series
    ]
    ids = [str(i.id) for i in insts]
    eng = BacktestEngine(
        BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, bypass_logging=True),
            risk_engine=risk,
        )
    )
    eng.add_venue(
        Venue("KALSHI"),
        OmsType.NETTING,
        AccountType.MARGIN,  # a sell with no position is a short YES (a long NO on Kalshi)
        [Money(1_000_000, Currency.from_str("USD"))],
        book_type=BookType.L2_MBP,
        queue_position=True,
        trade_execution=trade_execution,
        fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)),
        latency_model=StaticLatencyModel(base_latency_nanos=latency_ns) if latency_ns else None,
    )
    for i in insts:
        eng.add_instrument(i)
    eng.add_strategy(strategy)
    kind = NautilusDataType.OrderBookDelta
    first = min(cat.query_first_timestamp(kind, i) or 2**62 for i in ids)
    last = max(cat.query_last_timestamp(kind, i) or 0 for i in ids)
    for start in range(first - first % HOUR, last + 1, HOUR):
        deltas = cat.query_order_book_deltas(ids, start, start + HOUR - 1)
        trades = cat.query_trade_ticks(ids, start, start + HOUR - 1)
        if not deltas:
            continue
        deltas.sort(key=lambda d: d.ts_init)
        trades.sort(key=lambda t: t.ts_init)
        if reorder:
            trades = trades_first(deltas, trades)
        eng.add_data(deltas + trades)
        eng.run(streaming=True)
        eng.clear_data()
    eng.end()
    eng.dispose()


def closes(markets_file: Path, series: set[str]) -> dict[str, int]:
    """Each contract's close time (ns) from the recorder's Kalshi listings."""
    with tempfile.TemporaryDirectory() as tmp:
        rawcat, _ = build_tools(Path(tmp))
        return {
            m["ticker"]: int(iso_s(m["close_time"]) * S)
            for m in markets(rawcat, [str(markets_file)], series)
        }


def active_top(book) -> tuple[float, float, float, float] | None:
    """Best bid, its size, best ask, its size, when quoted on both sides with a mid of 5-95c
    (the same rule as manta-queue)."""
    if book is None:
        return None
    bid, ask = book.best_bid_price(), book.best_ask_price()
    if bid is None or ask is None:
        return None
    b, a = bid.as_double(), ask.as_double()
    if not 0.05 <= (b + a) / 2 <= 0.95:
        return None
    return b, book.best_bid_size().as_double(), a, book.best_ask_size().as_double()


class Probe(Strategy):
    """Sub-step 5: manta-queue's hypothetical orders, placed in Nautilus. Every minute, 1 contract
    at the best bid and the best ask of every active contract, held 5 minutes, never moved."""

    def __new__(cls, *args, **kwargs):  # Nautilus's Rust-backed Strategy takes no arguments here
        return super().__new__(cls)

    def __init__(self, closes_ns: dict[str, int], every_s: int = 60) -> None:
        super().__init__()
        self.closes = closes_ns
        self.every_ns = every_s * S
        self.orders: dict = {}  # client order id → record
        self.rejected = 0
        self.last = 0  # the last timer tick: where the data ends

    def on_start(self) -> None:
        for inst in self.cache.instruments():
            self.subscribe_book_deltas(inst.id, BookType.L2_MBP, managed=True)
        self.clock.set_timer_ns("place", self.every_ns)

    def on_time_event(self, event) -> None:
        now = self.last = self.clock.timestamp_ns()
        for coid, o in self.orders.items():
            if o["open"] and now - o["placed"] >= max(HORIZONS_S) * S:
                self.cancel_order(coid)
                o["open"] = False
        for inst in self.cache.instruments():
            top = active_top(self.cache.order_book(inst.id))
            if top is None:
                continue
            bid, bsz, ask, asz = top
            for side, px, ahead in ((OrderSide.BUY, bid, bsz), (OrderSide.SELL, ask, asz)):
                order = self.order_factory.limit(
                    inst.id, side, Quantity(1, 2), Price(px, 2), post_only=True
                )
                self.submit_order(order)
                self.orders[order.client_order_id] = {
                    "side": "bids" if side == OrderSide.BUY else "asks",
                    "px": px,
                    "ticker": inst.id.symbol.value,
                    "placed": now,
                    "ahead": ahead,
                    "filled": None,
                    "open": True,
                }

    def on_order_filled(self, event) -> None:
        o = self.orders.get(event.client_order_id)
        if o and o["filled"] is None:
            o["filled"] = event.ts_event

    def on_order_rejected(self, event) -> None:
        self.rejected += 1
        if o := self.orders.get(event.client_order_id):
            o["open"] = False
            o["rejected"] = True

    def on_order_denied(self, event) -> None:  # refused before reaching the venue
        self.on_order_rejected(event)

    def shares(self, data_end: int) -> dict:
        """Share filled within each horizon, overall and by queue ahead when placed, among orders
        whose contract stayed open and whose data lasted that long (manta-queue's censoring)."""
        out: dict = {}
        for h in HORIZONS_S:
            for o in self.orders.values():
                if o.get("rejected"):
                    continue
                end = min(self.closes.get(o["ticker"], 2**62), data_end)
                if end - o["placed"] < h * S:
                    continue
                hit = o["filled"] is not None and o["filled"] - o["placed"] <= h * S
                for g in ("all", bucket(o["ahead"])):
                    acc = out.setdefault(f"{g} {h}s", [0, 0])
                    acc[0] += hit
                    acc[1] += 1
        return {k: f"{f / n:.1%} of {n:,}" for k, (f, n) in sorted(out.items())}


def probe_main() -> None:
    ap = argparse.ArgumentParser(description="Sub-step 5: Nautilus fills vs manta-queue")
    ap.add_argument("--catalog", required=True, type=Path)
    ap.add_argument("--markets", required=True, type=Path, help="Kalshi listings (close times)")
    ap.add_argument("--series", default="KXBTCD")
    ap.add_argument("--no-reorder", action="store_true", help="replay trades in arrival order")
    ap.add_argument("--book-only", action="store_true", help="fill only when the book crosses")
    ap.add_argument("--dump", type=Path, help="write every probe order as JSON")
    ap.add_argument(
        "--every",
        type=int,
        default=60,
        help="seconds between placements; 300 keeps one order per contract side at a time",
    )
    a = ap.parse_args()
    probe = Probe(closes(a.markets, set(a.series.split(","))), a.every)
    replay(
        a.catalog,
        probe,
        reorder=not a.no_reorder,
        trade_execution=not a.book_only,
        series=set(a.series.split(",")),
        # A measuring device: hundreds of orders at one instant would trip the order-rate
        # check (denied as RATE_LIMIT_EXCEEDED, found 2026-11-25), so it is bypassed here.
        risk=RiskEngineConfig(bypass=True),
    )
    print(json.dumps({"rejected": probe.rejected, "shares": probe.shares(probe.last)}, indent=1))
    if a.dump:
        a.dump.write_text(json.dumps(list(probe.orders.values())))


SIZE = 5  # contracts per quote (rule 2: 1-10; tiny against the median queue of 1,132)
PER_CONTRACT, PER_EVENT, TOTAL = 20, 50, 200  # rule 6 caps, contracts, resting orders counted
SKEW_AT = 10  # rule 6: step back one cent on the side that adds to a position this large
GUARD = 0.02  # rule 4: no bid above fair + 2c, no ask below fair - 2c
STOP_NS = 15 * 60 * S  # rule 5: no quotes in a contract's last 15 minutes
AFTER_NS = 60 * S  # the split's horizon for adverse selection
# Kalshi's Basic tier: 100 write tokens a second, 10 per order (docs.kalshi.com, rate limits,
# read 2026-11-25). Nautilus throttles submits only; cancels (also 10 tokens) are not limited.
KALSHI_RATE = "10/00:00:01"


def event_of(ticker: str) -> str:
    """KXBTCD-26NOV2317-T62499.99 → KXBTCD-26NOV2317: one hourly close, one bet on Bitcoin."""
    return ticker.rsplit("-", 1)[0]


class MarketMaker(Strategy):
    """Sub-step 6: the approved quoting rules (docs/plan-market-maker.md).

    On every book change of a contract: join its best bid and best ask with SIZE contracts
    (post-only), unless the contract is inactive, within 15 minutes of its close, the price is on
    the wrong side of fair value by more than 2c, or a cap would be broken. Cancel and rejoin when
    the best price moves; cancel when the size at our price falls below `cancel_frac` of what it
    was when we joined (the level is being eaten) and wait `rejoin_ns` before rejoining."""

    def __new__(cls, *args, **kwargs):  # Nautilus's Rust-backed Strategy takes no arguments here
        return super().__new__(cls)

    def __init__(
        self,
        cancel_frac: float,
        rejoin_ns: int,
        closes_ns: dict[str, int],
        fair: dict[str, tuple[list[int], list[float]]],
    ) -> None:
        super().__init__()
        self.cancel_frac, self.rejoin_ns = cancel_frac, rejoin_ns
        self.closes, self.fair = closes_ns, fair
        self.pos: dict[str, float] = {}  # ticker → net contracts (+ long YES)
        self.live: dict[tuple, dict] = {}  # (ticker, side) → our order
        self.by_id: dict = {}  # client order id → (ticker, side)
        self.cool: dict[tuple, int] = {}  # (ticker, side) → no rejoin before this time
        self.hist: dict[str, list] = {}  # ticker → recent [time, mid]
        self.fills: list[dict] = []
        self.waiting: list[tuple[int, int]] = []  # (due time, fill index) for the mid 60 s on
        self.submitted = self.rejected = self.denied = 0
        self.peak = 0.0  # largest total position held
        self.settled: dict[str, float] = {}  # ticker → position held to its close
        self.next_purge = 0
        self.n_live: dict[str, int] = {}  # ticker → our orders on it
        self.seen: dict[str, tuple] = {}  # ticker → (best bid, best ask, time) last looked at

    def on_start(self) -> None:
        for inst in self.cache.instruments():
            self.subscribe_book_deltas(inst.id, BookType.L2_MBP, managed=True)

    # -- state helpers -----------------------------------------------------------------------

    def fair_at(self, ticker: str, now: int) -> float | None:
        ts, vals = self.fair.get(ticker, ((), ()))
        i = bisect.bisect_right(ts, now) - 1
        return vals[i] if i >= 0 and now - ts[i] <= 60 * S else None

    def mid_before(self, ticker: str, now: int) -> float | None:
        at = None
        for t, m in self.hist.get(ticker, ()):
            if t > now - S:
                break
            at = m
        return at

    def exposure_ok(self, ticker: str, side: int) -> bool:
        """Would one more resting order of SIZE stay inside every cap if every resting order
        filled? An order that shrinks a position adds nothing, so a full book can still unwind."""

        def worst(tk: str) -> float:
            p = self.pos.get(tk, 0.0)
            buys = sum(SIZE for (t, sd) in self.live if t == tk and sd == 1)
            sells = sum(SIZE for (t, sd) in self.live if t == tk and sd == -1)
            if tk == ticker:
                buys, sells = buys + (SIZE if side == 1 else 0), sells + (SIZE if side == -1 else 0)
            return max(abs(p + buys), abs(p - sells))

        if abs(self.pos.get(ticker, 0.0) + side * SIZE) > PER_CONTRACT:
            return False
        ev = event_of(ticker)
        tickers = set(self.pos) | {t for t, _ in self.live} | {ticker}
        event = sum(worst(t) for t in tickers if event_of(t) == ev)
        total = sum(worst(t) for t in tickers)
        return event <= PER_EVENT and total <= TOTAL

    # -- events ------------------------------------------------------------------------------

    def on_book_deltas(self, deltas) -> None:
        now = self.clock.timestamp_ns()
        self.settle_waiting(now)
        iid = deltas.instrument_id
        ticker = iid.symbol.value
        book = self.cache.order_book(iid)
        if book is None:
            return
        if not self.n_live.get(ticker):
            # Nothing of ours here: only a new best price (or a second passing) can change what
            # we do. Most book changes are below the best price; skipping them keeps the replay
            # affordable (880 s for 2 busy hours before this, 2026-11-25).
            b, a = book.best_bid_price(), book.best_ask_price()
            last = self.seen.get(ticker)
            if last and last[0] == b and last[1] == a and now - last[2] < S:
                return
            self.seen[ticker] = (b, a, now)
        top = active_top(book)
        if top is not None:
            h = self.hist.setdefault(ticker, [])
            m = (top[0] + top[2]) / 2
            if not h or h[-1][1] != m:
                h.append([now, m])
                while len(h) > 1 and h[1][0] <= now - 2 * S:
                    h.pop(0)
        if top is None and not self.n_live.get(ticker):
            return
        quoting = top is not None and now < self.closes.get(ticker, 0) - STOP_NS
        fair = self.fair_at(ticker, now)
        for side in (1, -1):
            key = (ticker, side)
            o = self.live.get(key)
            target = None
            if quoting:
                bid, bsz, ask, asz = top
                pos = self.pos.get(ticker, 0.0)
                target = bid if side == 1 else ask
                if side * pos >= SKEW_AT:  # step back on the side that adds to the position
                    target = round(target - side * 0.01, 2)
                if fair is not None and side * (target - fair) > GUARD:
                    target = None
                if target is not None and not 0.01 <= target <= 0.99:
                    target = None
            if o is not None:
                if o["state"] != "open":
                    continue  # waiting for the venue to answer
                level = book.get_quantity_at_level(
                    Price(o["px"], 2), OrderSide.SELL if side == 1 else OrderSide.BUY, 2
                ).as_double()  # get_quantity_at_level reads the side opposite to the one given
                shrunk = self.cancel_frac > 0 and level < self.cancel_frac * o["joined"]
                if target != o["px"] or shrunk:
                    self.cancel_order(o["id"])
                    o["state"] = "cancelling"
                    if shrunk:
                        self.cool[key] = now + self.rejoin_ns
                continue
            if target is None or now < self.cool.get(key, 0) or not self.exposure_ok(ticker, side):
                continue
            order = self.order_factory.limit(
                iid,
                OrderSide.BUY if side == 1 else OrderSide.SELL,
                Quantity(SIZE, 2),
                Price(target, 2),
                post_only=True,
            )
            joined = book.get_quantity_at_level(
                Price(target, 2), OrderSide.SELL if side == 1 else OrderSide.BUY, 2
            ).as_double()
            self.live[key] = {
                "id": order.client_order_id,
                "px": target,
                "joined": joined,
                "state": "pending",
            }
            self.by_id[order.client_order_id] = key
            self.n_live[ticker] = self.n_live.get(ticker, 0) + 1
            self.submit_order(order)
            self.submitted += 1

    def on_order_accepted(self, event) -> None:
        key = self.by_id.get(event.client_order_id)
        if key in self.live and self.live[key]["id"] == event.client_order_id:
            self.live[key]["state"] = "open"

    def _gone(self, event) -> None:
        key = self.by_id.pop(event.client_order_id, None)
        if key in self.live and self.live[key]["id"] == event.client_order_id:
            del self.live[key]
            self.n_live[key[0]] -= 1

    def on_order_canceled(self, event) -> None:
        self._gone(event)

    def on_order_expired(self, event) -> None:
        self._gone(event)

    def on_order_rejected(self, event) -> None:
        self.rejected += 1
        self._gone(event)

    def on_order_denied(self, event) -> None:  # e.g. over Kalshi's order rate (KALSHI_RATE)
        self.denied += 1
        self._gone(event)

    def on_order_filled(self, event) -> None:
        key = self.by_id.get(event.client_order_id)
        if key is None:
            return
        ticker, side = key
        qty = event.last_qty.as_double()
        self.pos[ticker] = self.pos.get(ticker, 0.0) + side * qty
        self.peak = max(self.peak, sum(abs(p) for p in self.pos.values()))
        self.fills.append(
            {
                "ticker": ticker,
                "ts": event.ts_event,
                "side": side,
                "price": event.last_px.as_double(),
                "qty": qty,
                "mid_before": self.mid_before(ticker, event.ts_event),
                "mid_after": None,
            }
        )
        heapq.heappush(self.waiting, (event.ts_event + AFTER_NS, len(self.fills) - 1))
        o = self.live.get(key)
        if o and o["id"] == event.client_order_id:
            o["filled"] = o.get("filled", 0.0) + qty
            if o["filled"] >= SIZE - 1e-9:
                self._gone(event)

    def settle_waiting(self, now: int) -> None:
        """Record the mid 60 s after each fill (None if the contract closed first: the report
        then uses its settlement value). Once a second, positions in closed contracts leave the
        caps: they settle to cash at the close."""
        if now >= self.next_purge:
            self.next_purge = now + S
            for tk in [t for t in self.pos if self.closes.get(t, 2**62) <= now]:
                self.settled[tk] = self.pos.pop(tk)
        while self.waiting and self.waiting[0][0] <= now:
            _, i = heapq.heappop(self.waiting)
            f = self.fills[i]
            if now >= self.closes.get(f["ticker"], 2**62):
                continue
            iid = InstrumentId.from_str(f"{f['ticker']}.KALSHI")
            top = active_top(self.cache.order_book(iid))
            book = self.cache.order_book(iid)
            if book is not None and book.best_bid_price() and book.best_ask_price():
                f["mid_after"] = (
                    book.best_bid_price().as_double() + book.best_ask_price().as_double()
                ) / 2
            elif top is not None:
                f["mid_after"] = (top[0] + top[2]) / 2


def load_fair(path: Path) -> dict[str, tuple[list[int], list[float]]]:
    t = pq.read_table(path).to_pydict()
    out: dict[str, tuple[list[int], list[float]]] = {}
    for tk, ts, f in zip(t["ticker"], t["ts"], t["fair"], strict=True):
        out.setdefault(tk, ([], []))
        out[tk][0].append(ts)
        out[tk][1].append(f)
    return out


def backtest_main() -> None:
    ap = argparse.ArgumentParser(description="Sub-step 6: run the market maker on one day")
    ap.add_argument("--catalog", required=True, type=Path)
    ap.add_argument("--markets", required=True, type=Path, help="Kalshi listings (close times)")
    ap.add_argument("--fair", type=Path, help="manta-fair-series output (none for KXBTC15M)")
    ap.add_argument("--series", default="KXBTCD")
    ap.add_argument("--cancel-frac", type=float, required=True)
    ap.add_argument("--rejoin", type=float, required=True, help="seconds")
    ap.add_argument("--latency-ms", type=float, default=56)
    ap.add_argument("--out", required=True, type=Path, help="fills as JSON")
    a = ap.parse_args()
    mm = MarketMaker(
        a.cancel_frac,
        int(a.rejoin * S),
        closes(a.markets, set(a.series.split(","))),
        load_fair(a.fair) if a.fair else {},
    )
    replay(
        a.catalog,
        mm,
        latency_ns=int(a.latency_ms * 1_000_000),
        series=set(a.series.split(",")),
        risk=RiskEngineConfig(max_order_submit_rate=KALSHI_RATE),
    )
    run = {k: getattr(a, k) for k in ("cancel_frac", "rejoin", "latency_ms", "series")}
    run |= {"submitted": mm.submitted, "rejected": mm.rejected, "denied": mm.denied}
    run |= {"peak": mm.peak}
    a.out.write_text(json.dumps({"run": run, "fills": mm.fills}))
    print(json.dumps(run | {"fills": len(mm.fills)}))


KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"


def settlements(tickers: set[str], cache: Path) -> dict[str, float]:
    """Each contract's settlement value ($1 YES, $0 NO) from Kalshi's public API, one request
    per hourly event, kept in `cache` so a report can be rerun offline."""
    known: dict[str, float] = json.loads(cache.read_text()) if cache.exists() else {}
    for ev in sorted({event_of(t) for t in tickers if t not in known}):
        url = f"{KALSHI_API}/markets?event_ticker={ev}&limit=1000"
        with urllib.request.urlopen(url, timeout=30) as r:
            for m in json.load(r)["markets"]:
                if m.get("result") in ("yes", "no"):
                    known[m["ticker"]] = 1.0 if m["result"] == "yes" else 0.0
    cache.write_text(json.dumps(known))
    return known


def report_main() -> None:
    ap = argparse.ArgumentParser(description="Profit and loss split of manta-mm-backtest runs")
    ap.add_argument("runs", nargs="+", type=Path, help="LABEL=fills.json (e.g. tuning=...)")
    ap.add_argument("--settle", required=True, type=Path, help="settlement cache (JSON)")
    a = ap.parse_args()
    loaded = []
    for arg in a.runs:
        label, path = str(arg).split("=", 1)
        loaded.append((label, Path(path), json.loads(Path(path).read_text())))
    settle = settlements({f["ticker"] for *_, d in loaded for f in d["fills"]}, a.settle)
    print(
        "| Set | Run | Orders sent | Refused at the rate limit | Fills | Contracts | Spread earned "
        "| Adverse selection | Inventory | Fees | Total | Total per contract | Peak position |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for label, path, d in loaded:
        fills, unsettled = [], 0
        for f in d["fills"]:
            v = settle.get(f["ticker"])
            if v is None:  # closes after today: valued at its mid 60 s after the fill
                unsettled += 1
                v = f["mid_after"] if f["mid_after"] is not None else f["price"]
            fills.append(
                Fill(
                    f["ticker"],
                    f["ts"],
                    f["side"],
                    f["price"],
                    f["qty"],
                    kalshi_fee(f["price"], f["qty"], 0.0),  # post-only: maker, no fee on KXBTCD
                    f["mid_before"] if f["mid_before"] is not None else f["price"],
                    f["mid_after"] if f["mid_after"] is not None else v,
                    v,
                )
            )
        p = split(fills)
        qty = sum(f.qty for f in fills)
        per = 100 * p["total"] / qty if qty else 0.0
        cells = " | ".join(f"${p[k]:+,.2f}" for k in ("spread", "adverse", "inventory", "fees"))
        r = d["run"]
        print(
            f"| {label} | {path.stem} | {r['submitted']:,} | {r.get('denied', 0):,} | "
            f"{len(fills):,} | {qty:,.0f} | {cells} | "
            f"${p['total']:+,.2f} | {per:+.2f}¢ | {r['peak']:.0f} |"
            + (f" ({unsettled} fills not yet settled, valued at their mid)" if unsettled else "")
        )
