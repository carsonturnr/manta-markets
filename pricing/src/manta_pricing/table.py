"""Milestone 2 demo: a live table of Kalshi Bitcoin contracts, Kalshi's price, our fair value
from Deribit's options, and the gap.

    uv run manta-fair [--hours 6] [--band 0.03]

Read-only public data: Kalshi markets (series KXBTCD and KXBTC only: an explicit list, never
sports), Deribit option summaries and the BTC index. No account, no orders.
"""

import argparse
import json
import time
import urllib.request
from datetime import UTC, datetime

from manta_pricing.fair import AVERAGING_WINDOW_S, Quote, prob_above, prob_between
from manta_pricing.surface import Surface

KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
DERIBIT = "https://www.deribit.com/api/v2/public"
SERIES = ("KXBTCD", "KXBTC")  # above/below and ranges; KXBTC15M comes later


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "manta-markets/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def kalshi_markets(series: str) -> list[dict]:
    return kalshi_query(f"series_ticker={series}&status=open")


def kalshi_query(query: str) -> list[dict]:
    """Every market matching a /markets query, across pages."""
    out, cursor = [], ""
    while True:
        page = get(f"{KALSHI}/markets?{query}&limit=1000&cursor={cursor}")
        out += page["markets"]
        cursor = page.get("cursor") or ""
        if not cursor or not page["markets"]:
            return out


def ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def price(m: dict, surf: Surface, spot: float, now: float) -> float | None:
    """Fair probability for a Kalshi market, or None inside the averaging window."""
    close = ts(m["close_time"])
    tau = close - now
    if tau < AVERAGING_WINDOW_S:
        return None

    def quote(k: float) -> Quote:
        return Quote(spot, k, surf.vol(k, close, now), surf.vol_slope(k, close, now), tau)

    if m["strike_type"] == "greater":
        return prob_above(quote(m["floor_strike"]))
    if m["strike_type"] == "less":
        return 1 - prob_above(quote(m["cap_strike"]))
    if m["strike_type"] == "between":
        return prob_between(quote(m["floor_strike"]), quote(m["cap_strike"]))
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--hours", type=float, default=24, help="contracts closing within this many hours"
    )
    ap.add_argument("--band", type=float, default=0.05, help="strikes within this fraction of BTC")
    a = ap.parse_args()

    now = time.time()
    spot = get(f"{DERIBIT}/get_index_price?index_name=btc_usd")["result"]["index_price"]
    summaries = get(f"{DERIBIT}/get_book_summary_by_currency?currency=BTC&kind=option")["result"]
    surf = Surface.from_deribit(summaries, now)
    rows = []
    for series in SERIES:
        for m in kalshi_markets(series):
            close = ts(m["close_time"])
            strike = m.get("floor_strike") or m.get("cap_strike")
            if close - now > a.hours * 3600 or not strike or abs(strike / spot - 1) > a.band:
                continue
            bid, ask = float(m.get("yes_bid_dollars") or 0), float(m.get("yes_ask_dollars") or 0)
            if not 0.03 <= (bid + ask) / 2 <= 0.97:  # all but settled: nothing to compare
                continue
            rows.append((close, strike, m["ticker"], bid, ask, price(m, surf, spot, now)))
    rows.sort()

    first = datetime.fromtimestamp(surf.smiles[0].expiry, UTC)
    print(f"BTC index ${spot:,.2f} (Deribit) · nearest Deribit expiry {first:%b %d %H:%M} UTC")
    print(f"as of {datetime.fromtimestamp(now, UTC):%Y-%m-%d %H:%M:%S} UTC")
    last_close = None
    for close, _, ticker, bid, ask, fair in rows:
        if close != last_close:
            mins = (close - now) / 60
            when = f"{mins / 60:.1f} h" if mins >= 90 else f"{mins:.0f} min"
            print(f"\ncloses {datetime.fromtimestamp(close, UTC):%b %d %H:%M} UTC (in {when})")
            print(f"  {'contract':32s} {'bid':>5s} {'ask':>5s} {'fair':>6s} {'gap':>6s}")
            last_close = close
        if fair is None:
            print(f"  {ticker:32s} {bid * 100:5.0f} {ask * 100:5.0f}  in the 60 s window")
            continue
        # gap: fair value minus Kalshi's mid, in cents; marked when fair is outside bid–ask.
        mark = " <" if fair < bid else (" >" if fair > ask else "")
        gap = (fair - (bid + ask) / 2) * 100
        print(
            f"  {ticker:32s} {bid * 100:5.0f} {ask * 100:5.0f} {fair * 100:6.1f} {gap:+6.1f}{mark}"
        )
    if not rows:
        print("\nno open contracts priced between 3¢ and 97¢ in this window")
    print("\nPrices in cents. gap = fair − Kalshi mid; '>' fair above the ask, '<' below the bid.")


if __name__ == "__main__":
    main()
