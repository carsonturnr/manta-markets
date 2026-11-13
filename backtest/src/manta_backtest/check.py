"""Check a catalog against an independent source: the tracker's once-a-minute Kalshi bid/ask
(Milestone 3, taken from Kalshi's REST API, while the catalog comes from the recorder's WebSocket
feed). Each book is rebuilt from the catalog's deltas, and its best bid and ask at each tracker
snapshot are compared with what the tracker saw.

    uv run --env-file ../site/.env.local manta-catalog-check ../data/catalog

The two are taken at slightly different moments (the tracker's REST call is not synchronized with
the feed), so a small share of differences are timing, not errors; the check reports how many
differ and how many of those differ when compared with a few seconds' slack.
"""

import argparse
import os
from bisect import bisect_right

import psycopg
from nautilus_trader.model import BookType, OrderBook
from nautilus_trader.persistence import ParquetDataCatalog


def tops(deltas: list) -> tuple[list[int], list[tuple[float | None, float | None]]]:
    """Best bid and ask after each F_LAST delta, with its receive time."""
    book = OrderBook(deltas[0].instrument_id, BookType.L2_MBP)
    times, values = [], []
    for d in deltas:
        book.apply_delta(d)
        if d.flags & 128:  # F_LAST: the end of one update
            bid, ask = book.best_bid_price(), book.best_ask_price()
            times.append(d.ts_init)
            values.append((bid.as_double() if bid else None, ask.as_double() if ask else None))
    return times, values


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("catalog")
    ap.add_argument("--slack", type=float, default=5, help="seconds either side counted as timing")
    a = ap.parse_args()
    slack = int(a.slack * 1e9)
    catalog = ParquetDataCatalog(a.catalog)
    ids = [str(i.id) for i in catalog.instruments()]

    with psycopg.connect(os.environ["DATABASE_URL"]) as db:
        rows = db.execute(
            """select q.ticker, (extract(epoch from q.ts) * 1e9)::bigint, q.yes_bid, q.yes_ask
               from manta.quotes q where q.ticker = any(%s) order by q.ticker, q.ts""",
            ([i.removesuffix(".KALSHI") for i in ids],),
        ).fetchall()

    by_ticker: dict[str, list] = {}
    for t, ts, bid, ask in rows:
        by_ticker.setdefault(t, []).append((ts, bid, ask))

    n = exact = timing = outside = 0
    examples = []
    for ticker, snaps in by_ticker.items():
        deltas = catalog.query_order_book_deltas([f"{ticker}.KALSHI"])
        if not deltas:
            continue
        times, values = tops(deltas)
        for ts, bid, ask in snaps:
            i = bisect_right(times, ts) - 1
            if i < 0 or ts > times[-1] + 60_000_000_000:
                outside += 1  # the tracker's minute isn't covered by the catalog
                continue
            n += 1
            # Kalshi's REST shows 0 for no bid and 1 for no ask.
            want = (bid or None, None if ask >= 1 else ask)
            if _same(values[i], want):
                exact += 1
                continue
            lo, hi = bisect_right(times, ts - slack), bisect_right(times, ts + slack)
            if any(_same(values[j], want) for j in range(max(lo - 1, 0), hi)):
                timing += 1
            elif len(examples) < 8:
                examples.append(f"{ticker} at {ts}: catalog {values[i]}, tracker {want}")
    off = n - exact - timing
    print(f"compared {n} tracker snapshots across {len(by_ticker)} contracts ({outside} outside)")
    print(f"  same best bid and ask: {exact} ({100 * exact / max(n, 1):.2f}%)")
    print(f"  same within ±{a.slack:g} s (timing): {timing}")
    print(f"  different: {off} ({100 * off / max(n, 1):.2f}%)")
    for e in examples:
        print("   ", e)


def _same(a: tuple, b: tuple) -> bool:
    return all(
        (x is None and y is None) or (x is not None and y is not None and abs(x - y) < 1e-9)
        for x, y in zip(a, b, strict=True)
    )


if __name__ == "__main__":
    main()
