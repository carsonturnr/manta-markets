"""Milestone 3: one snapshot of Kalshi's prices and our fair values, written to Postgres
(docs/milestone-3-tracker.md).

    uv run --env-file ../.env manta-snap            # one snapshot (the VM runs this every minute)
    uv run --env-file ../.env manta-snap --status   # what the database holds
    uv run --env-file ../.env manta-snap --init     # create the tables and the site's login

Each run stands alone: fetch, price, write in one transaction, then fill in results for
contracts Kalshi has settled since. A failed run is a missing minute, nothing more. Read-only
public data (KXBTCD and KXBTC only), no orders.
"""

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from psycopg import sql

from manta_pricing.surface import Surface
from manta_pricing.table import (
    DERIBIT,
    KALSHI,
    SERIES,
    get,
    kalshi_markets,
    kalshi_query,
    price,
    ts,
)

SCHEMA = Path(__file__).resolve().parents[3] / "db" / "schema.sql"
HORIZON_S = 48 * 3600  # within 2 days: the next daily close is always in range, even overnight
# Store a contract if Kalshi's mid or our fair value is inside this. Outside it, both say the
# contract is all but certain: nothing to compare, and the rows would fill the 500 MB database.
IN_PLAY = (0.03, 0.97)
# Contracts further from their close than this are stored every 5 minutes, not every minute:
# a day out, prices drift slowly, and minute detail matters in the final hours.
FAR_S = 6 * 3600
FAR_EVERY_MIN = 5


def connect() -> psycopg.Connection:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (locally: uv run --env-file ../.env ...)")
    conn = psycopg.connect(url, autocommit=True)
    conn.execute("set time zone 'UTC'")  # timestamps print and group in UTC
    return conn


def in_play(p: float | None) -> bool:
    return p is not None and IN_PLAY[0] <= p <= IN_PLAY[1]


def top_of_book(ticker: str) -> tuple[float, float]:
    """Kalshi's best YES bid and ask from the market's live order book. Not the bid/ask in the
    market list: that trails the book by up to about a minute (measured 2026-11-13,
    docs/milestone-4-backtest.md). No bid is 0 and no ask is 1, as in the market list."""
    book = get(f"{KALSHI}/markets/{ticker}/orderbook")["orderbook_fp"]
    yes = [float(p) for p, _ in book.get("yes_dollars") or []]
    no = [float(p) for p, _ in book.get("no_dollars") or []]  # a NO bid at n is a YES ask at 1 − n
    return (max(yes) if yes else 0.0, round(1 - max(no), 4) if no else 1.0)


def live_tops(tickers: list[str]) -> dict[str, tuple[float, float]]:
    """top_of_book for each ticker, six requests at a time; a failed one is left out."""

    def one(t: str) -> tuple[str, tuple[float, float] | None]:
        try:
            return t, top_of_book(t)
        except Exception as e:
            print(f"orderbook {t}: {e}", file=sys.stderr)
            return t, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        return {t: top for t, top in pool.map(one, tickers) if top is not None}


def coinbase_spot() -> float | None:
    """Coinbase BTC/USD last trade. Optional: a failure here shouldn't lose the snapshot."""
    try:
        return float(get("https://api.exchange.coinbase.com/products/BTC-USD/ticker")["price"])
    except Exception as e:
        print(f"coinbase: {e}", file=sys.stderr)
        return None


def snapshot(conn: psycopg.Connection) -> None:
    now = time.time()
    spot = get(f"{DERIBIT}/get_index_price?index_name=btc_usd")["result"]["index_price"]
    summaries = get(f"{DERIBIT}/get_book_summary_by_currency?currency=BTC&kind=option")["result"]
    surf = Surface.from_deribit(summaries, now)
    cb = coinbase_spot()

    far_minute = round(now / 60) % FAR_EVERY_MIN == 0  # the timer fires on the minute
    contracts, quotes = [], []
    for series in SERIES:
        for m in kalshi_markets(series):
            close = ts(m["close_time"])
            if close - now > HORIZON_S or (close - now > FAR_S and not far_minute):
                continue
            bid, ask = float(m.get("yes_bid_dollars") or 0), float(m.get("yes_ask_dollars") or 0)
            fair = price(m, surf, spot, now)
            if not (in_play((bid + ask) / 2) or in_play(fair)):
                continue
            strike = m.get("floor_strike") or m.get("cap_strike")
            contracts.append(
                (
                    m["ticker"],
                    series,
                    m["event_ticker"],
                    m["strike_type"],
                    m.get("floor_strike"),
                    m.get("cap_strike"),
                    m["close_time"],
                )
            )
            quotes.append((m["ticker"], fair, surf.vol(strike, close, now)))

    # The market list picked the contracts; their stored bid and ask come from the live books.
    tops = live_tops([q[0] for q in quotes])
    quotes = [(t, *tops[t], fair, vol) for t, fair, vol in quotes if t in tops]
    at = datetime.fromtimestamp(int(now), UTC)  # whole seconds: the site matches on it exactly
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "insert into manta.runs (ts, deribit_index, coinbase, priced) values (%s, %s, %s, %s)",
            (at, spot, cb, len(quotes)),
        )
        cur.executemany(
            """insert into manta.contracts
                   (ticker, series, event_ticker, strike_type, floor_strike, cap_strike, close_time)
               values (%s, %s, %s, %s, %s, %s, %s) on conflict (ticker) do nothing""",
            contracts,
        )
        cur.executemany(
            """insert into manta.quotes (ts, ticker, yes_bid, yes_ask, fair, vol)
               values (%s, %s, %s, %s, %s, %s)""",
            [(at, *q) for q in quotes],
        )
    missed = len(contracts) - len(quotes)
    note = f" ({missed} order books failed)" if missed else ""
    print(f"{at:%Y-%m-%d %H:%M:%S} UTC: index {spot:,.2f}, {len(quotes)} contracts{note}")


def settle(conn: psycopg.Connection) -> None:
    """Fill in result and settlement value for closed contracts Kalshi has finalized. Kalshi
    takes a few minutes after the close; unsettled ones are retried each run for 3 days."""
    pending: dict[str, set[str]] = {}
    for event, ticker in conn.execute(
        """select event_ticker, ticker from manta.contracts
           where result is null and close_time < now() - interval '1 minute'
             and close_time > now() - interval '3 days'"""
    ):
        pending.setdefault(event, set()).add(ticker)
    for event, tickers in pending.items():
        done = [
            (m["result"], float(m["expiration_value"]), m["ticker"])
            for m in kalshi_query(f"event_ticker={event}")
            if m["ticker"] in tickers
            and m.get("result") in ("yes", "no")
            and m.get("expiration_value")
        ]
        with conn.transaction():
            conn.cursor().executemany(
                """update manta.contracts set result = %s, settlement_value = %s
                   where ticker = %s and result is null""",
                done,
            )
        if done:
            print(f"settled {event}: {len(done)} contracts at {done[0][1]:,.2f}")


def status(conn: psycopg.Connection) -> None:
    def q(query: str) -> tuple:
        return conn.execute(query).fetchone()

    first, last, n = q("select min(ts), max(ts), count(*) from manta.runs")
    if not n:
        print("no snapshots yet")
        return
    hour = q("select count(*) from manta.runs where ts > now() - interval '1 hour'")[0]
    quotes = q("select count(*) from manta.quotes")[0]
    settled, open_ = q(
        "select count(*) filter (where result is not null), count(*) filter (where result is null)"
        " from manta.contracts"
    )
    size = q(
        "select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c"
        " join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'manta'"
    )[0]
    span = (last - first).total_seconds() / 3600
    print(f"snapshots: {n} from {first:%Y-%m-%d %H:%M} to {last:%Y-%m-%d %H:%M} UTC ({span:.1f} h)")
    print(f"last hour: {hour} of 60 minutes")
    print(f"quotes:    {quotes}")
    print(f"contracts: {settled} settled, {open_} not yet")
    print(f"size:      {size} (Supabase free tier: 500 MB)")


def init(conn: psycopg.Connection) -> None:
    with conn.transaction():
        conn.execute(SCHEMA.read_text())
        pw = os.environ.get("SITE_DB_PASSWORD")
        if pw:
            conn.execute(sql.SQL("alter role manta_site password {}").format(sql.Literal(pw)))
    print("schema applied" + ("; manta_site password set" if pw else ""))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--status", action="store_true", help="show what the database holds")
    ap.add_argument("--init", action="store_true", help="create tables and the site's login")
    a = ap.parse_args()
    with connect() as conn:
        if a.init:
            init(conn)
        elif a.status:
            status(conn)
        else:
            snapshot(conn)
            settle(conn)


if __name__ == "__main__":
    main()
