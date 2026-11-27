"""Milestone 4, step 1: recorded Kalshi data → NautilusTrader's Parquet data catalog
(docs/milestone-4-backtest.md).

    uv run manta-catalog --out ../data/catalog ../data/raw/kalshi/2026-11-13/*.jsonl.gz

Two Go tools from recorder/ do the reading: `rawcat` gives the market listings the recorder saved
(for the instruments), and `normalize` turns the raw messages into md.v1 books and trades: one
YES book per market, with Kalshi's NO bids as YES asks, checked against sequence numbers and REST
snapshots. This module only translates those into Nautilus objects:

- each market → a BinaryOption with the live adapter's ID, `<ticker>.KALSHI`;
- a book snapshot → CLEAR, then one ADD per level (flagged as a snapshot);
- a book delta → UPDATE per changed level (DELETE when its size drops to 0);
- a trade → TradeTick.

Timestamps: ts_init is when the recorder received the message; ts_event is Kalshi's own time when
the message carries one, otherwise the receive time.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from nautilus_trader.model import (
    AggressorSide,
    AssetClass,
    BinaryOption,
    BookAction,
    BookOrder,
    Currency,
    InstrumentId,
    OrderBookDelta,
    OrderSide,
    Price,
    Quantity,
    RecordFlag,
    Symbol,
    TradeId,
    TradeTick,
)
from nautilus_trader.persistence import ParquetDataCatalog

RECORDER = Path(__file__).resolve().parents[3] / "recorder"
SIZE_PRECISION = 2  # Kalshi contracts are fractional to 0.01
F_LAST, F_SNAPSHOT = RecordFlag.F_LAST.value, RecordFlag.F_SNAPSHOT.value
CHUNK = 500_000  # deltas per catalog write, to bound memory


def build_tools(dest: Path) -> tuple[Path, Path]:
    """Compile recorder/cmd/{rawcat,normalize} for this machine."""
    for tool in ("rawcat", "normalize"):
        subprocess.run(
            ["go", "build", "-o", str(dest / tool), f"./cmd/{tool}"], cwd=RECORDER, check=True
        )
    return dest / "rawcat", dest / "normalize"


def ns(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1e9)


def instrument(m: dict, ts: int) -> BinaryOption:
    """A Kalshi market as the live adapter models it: one YES-priced binary option."""
    steps = [Decimal(r["step"]) for r in m.get("price_ranges") or []] or [Decimal("0.01")]
    step = min(steps)  # the finest step on the grid (whole cents for KXBTCD: "linear_cent")
    precision = max(0, -step.normalize().as_tuple().exponent)  # "0.0100" is 2 places, not 4
    return BinaryOption(
        instrument_id=InstrumentId.from_str(f"{m['ticker']}.KALSHI"),
        raw_symbol=Symbol(m["ticker"]),
        asset_class=AssetClass.ALTERNATIVE,
        currency=Currency.from_str("USD"),
        activation_ns=ns(m["open_time"]),
        expiration_ns=ns(m["latest_expiration_time"]),
        price_precision=precision,
        size_precision=SIZE_PRECISION,
        price_increment=Price(float(step), precision),
        size_increment=Quantity(0.01, SIZE_PRECISION),
        ts_event=ts,
        ts_init=ts,
        outcome="YES",
        description=m.get("title"),
        min_quantity=Quantity(0.01, SIZE_PRECISION),
        margin_init=Decimal(0),
        margin_maint=Decimal(0),
    )


def series_of(ticker: str) -> str:
    return ticker.split("-", 1)[0]


def listings(rawcat: Path, files: list[str], series: set[str]) -> dict[str, BinaryOption]:
    """The latest recorded listing of each market in `series`, as instruments."""
    out: dict[str, BinaryOption] = {}
    proc = subprocess.Popen([rawcat, *files], stdout=subprocess.PIPE, text=True)
    assert proc.stdout
    for line in proc.stdout:
        if '"stream":"markets"' not in line:
            continue
        r = json.loads(line)
        for m in r["msg"].get("markets", []):
            if series_of(m["ticker"]) in series:
                out[m["ticker"]] = instrument(m, r["recv_ns"])
    proc.wait()
    return out


def price(px: str, inst: BinaryOption) -> Price:
    """A recorded price on the instrument's grid. Price() would silently round an off-grid price
    and corrupt the book, so refuse it instead."""
    p = Price(float(px), inst.price_precision)
    if Decimal(px) != p.as_decimal():
        raise ValueError(f"{inst.id}: price {px} is off the {inst.price_increment} grid")
    return p


def deltas(msg: dict, inst: BinaryOption) -> list[OrderBookDelta]:
    """One md.v1 book message as Nautilus book deltas; the last one carries F_LAST."""
    iid = inst.id
    recv = msg["recv_ts"]
    event = msg["venue_ts_ms"] * 1_000_000 if msg.get("venue_ts_ms") else recv
    seq = msg.get("venue_seq") or 0
    snapshot = msg["kind"] == "snapshot"
    # A CLEAR built here, not OrderBookDelta.clear(): that one has precision 0, and the catalog
    # stores one precision per instrument.
    zero = BookOrder(
        OrderSide.NO_ORDER_SIDE, Price(0, inst.price_precision), Quantity(0, SIZE_PRECISION), 0
    )
    out = (
        [OrderBookDelta(iid, BookAction.CLEAR, zero, F_SNAPSHOT, seq, event, recv)]
        if snapshot
        else []
    )
    flags = F_SNAPSHOT if snapshot else 0
    for side, levels in ((OrderSide.BUY, msg["bids"]), (OrderSide.SELL, msg["asks"])):
        for px, sz in levels:
            size = Quantity(float(sz), SIZE_PRECISION)
            if snapshot:
                action = BookAction.ADD
            else:
                action = BookAction.DELETE if size.as_double() == 0 else BookAction.UPDATE
            order = BookOrder(side, price(px, inst), size, 0)
            out.append(OrderBookDelta(iid, action, order, flags, seq, event, recv))
    if out:
        last = out[-1]
        out[-1] = OrderBookDelta(
            iid, last.action, last.order, last.flags | F_LAST, seq, last.ts_event, last.ts_init
        )
    return out


AGGRESSOR = {"buy": AggressorSide.BUY, "sell": AggressorSide.SELL}


def trade(msg: dict, inst: BinaryOption) -> TradeTick:
    recv = msg["recv_ts"]
    event = msg["venue_ts_ms"] * 1_000_000 if msg.get("venue_ts_ms") else recv
    return TradeTick(
        inst.id,
        price(msg["px"], inst),
        Quantity(float(msg["sz"]), SIZE_PRECISION),
        AGGRESSOR.get(msg["side"], AggressorSide.NO_AGGRESSOR),
        TradeId(msg.get("trade_id") or f"{msg['market_id']}-{msg['rseq']}"),
        event,
        recv,
    )


def convert(
    files: list[str], out: Path, series: set[str], listings_from: list[str] | None = None
) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        rawcat, normalize = build_tools(Path(tmp))
        # The listings can come from a separate file, so `files` are read once (they may be pipes).
        insts = listings(rawcat, listings_from or files, series)
        out.mkdir(parents=True, exist_ok=True)
        catalog = ParquetDataCatalog(str(out))
        catalog.write_instruments(list(insts.values()))

        stats = {
            "instruments": len(insts),
            "book_msgs": 0,
            "deltas": 0,
            "trades": 0,
            "unlisted_skipped": 0,
        }
        book: dict[str, list[OrderBookDelta]] = {}  # by ticker: the catalog writes one at a time
        trades: dict[str, list[TradeTick]] = {}
        pending = 0

        def flush() -> None:
            for rows in book.values():
                catalog.write_order_book_deltas(rows)
            for rows in trades.values():
                catalog.write_trade_ticks(rows)
            book.clear()
            trades.clear()

        proc = subprocess.Popen(
            [normalize, "-venue", "kalshi", *files],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert proc.stdout and proc.stderr
        for line in proc.stdout:
            rec = json.loads(line)
            msg = rec["msg"]
            ticker = msg.get("market_id")
            if rec["type"] not in ("book", "trade") or series_of(ticker) not in series:
                continue
            inst = insts.get(ticker)
            if inst is None:  # traded before its first recorded listing
                stats["unlisted_skipped"] += 1
                continue
            if rec["type"] == "book":
                rows = deltas(msg, inst)
                book.setdefault(ticker, []).extend(rows)
                stats["book_msgs"] += 1
                stats["deltas"] += len(rows)
                pending += len(rows)
            else:
                trades.setdefault(ticker, []).append(trade(msg, inst))
                stats["trades"] += 1
            if pending >= CHUNK:
                flush()
                pending = 0
        flush()
        stats["normalizer"] = json.loads(proc.stderr.read() or "{}")
        if proc.wait() != 0:
            sys.exit("normalize failed")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("files", nargs="+", help="raw Kalshi hourly files, in time order")
    ap.add_argument("--out", required=True, type=Path, help="catalog directory")
    ap.add_argument("--series", default="KXBTCD", help="comma-separated Kalshi series")
    ap.add_argument("--listings", nargs="+", help="read market listings from these files instead")
    a = ap.parse_args()
    stats = convert(sorted(a.files), a.out, set(a.series.split(",")), a.listings)
    norm = stats.pop("normalizer")
    print(json.dumps(stats))
    keys = ("delta_mismatches", "rest_mismatches", "ws_snapshot_mismatches", "coverage_pct")
    print("normalizer:", json.dumps({k: norm.get(k) for k in keys}))


if __name__ == "__main__":
    main()
