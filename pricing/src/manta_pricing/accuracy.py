"""Predictions for the accuracy page (step 9, docs/product.md): one per contract at fixed times
before it is decided, scored later against what happened.

Every minute manta-contracts passes `due` the listing it has just priced. A contract decided 5
minutes, 1 hour, 1 day or 1 week from now (to within a tenth of that, at least a minute) has its
venue's bid and ask and our fair value stored once in manta.predictions; later minutes don't
replace it. Every 5 minutes `settle` fills in results from Kalshi and Polymarket. Storing one
prediction per contract and horizon, not one a minute, keeps sample sizes honest: minute-by-minute
rows of one contract are nearly the same prediction.

When a contract is decided: its close, except for Polymarket's economics markets, which keep
trading for hours after the figure is published (CPI's markets close at 04:59 UTC the next day,
for a 13:30 release). Those use the close of the Kalshi contract they're paired with (step 4); one
without a pair is left out. Kalshi closes a minute before a release, and Polymarket's crypto
markets close when they settle, at noon New York time.

Read-only public data, no orders.
"""

import json
from datetime import UTC, datetime

import psycopg

from manta_pricing.fairvalues import Fair, key, ts
from manta_pricing.table import get, kalshi_query

GAMMA = "https://gamma-api.polymarket.com"
HORIZONS_MIN = (5, 60, 1440, 10080)  # 5 minutes, 1 hour, 1 day, 1 week
POLY_ECONOMICS = {"fed-decision", "cpi", "unemployment", "payrolls"}
SETTLE_EVERY_MIN = 5
SETTLE_DAYS = 14  # Polymarket's economics markets can take days to resolve


def decided_at(c: dict, paired: dict[str, float]) -> float | None:
    if c["venue"] == "polymarket" and c["family"] in POLY_ECONOMICS:
        return paired.get(c["id"])
    return ts(c["close"])


def due(
    contracts: list[dict], pairs: list[dict], fairs: dict[tuple[str, str], Fair], now: float
) -> list[tuple]:
    """Rows for manta.predictions: (venue, id, family, event, horizon, ts, decided, bid, ask,
    fair, fair_method). Only contracts quoted on both sides: a mid needs a bid and an ask."""
    paired = {i: ts(p["close"]) for p in pairs for i in p["polymarket"]["ids"]}
    at = datetime.fromtimestamp(now, UTC)
    rows = []
    for c in contracts:
        decided = decided_at(c, paired)
        if decided is None or c["bid"] is None or c["ask"] is None:
            continue
        left = (decided - now) / 60
        for h in HORIZONS_MIN:
            if h - max(1, h / 10) < left <= h:
                fair, method = fairs.get(key(c), (None, None))
                when = datetime.fromtimestamp(decided, UTC)
                head = [c["venue"], c["id"], c["family"], c["event"], h, at, when]
                rows.append((*head, c["bid"], c["ask"], fair, method))
    return rows


def store(conn: psycopg.Connection, rows: list[tuple]) -> int:
    """Insert the rows not stored yet; returns how many were new."""
    cur = conn.cursor()
    cur.executemany(
        "insert into manta.predictions"
        " (venue, id, family, event, horizon, ts, decided, bid, ask, fair, fair_method)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
        rows,
    )
    return max(cur.rowcount, 0)


def kalshi_result(m: dict) -> int | None:
    return {"yes": 1, "no": 0}.get(m.get("result", ""))


def polymarket_result(m: dict) -> int | None:
    """1 or 0 once the market has resolved to Yes or No; None before, or for a 50-50 split."""
    if not m.get("closed") or m.get("umaResolutionStatus") != "resolved":
        return None
    try:
        outcomes, prices = json.loads(m["outcomes"]), json.loads(m["outcomePrices"])
    except (KeyError, TypeError, ValueError):
        return None
    if outcomes != ["Yes", "No"]:
        return None
    return {("1", "0"): 1, ("0", "1"): 0}.get(tuple(prices))


def settle(conn: psycopg.Connection) -> None:
    """Fill in results for decided contracts the venues have settled. Unsettled ones are retried
    on each run for SETTLE_DAYS."""
    pending = conn.execute(
        """select distinct venue, id, event from manta.predictions
           where result is null and decided < now() - interval '1 minute'
             and decided > now() - %s * interval '1 day'""",
        [SETTLE_DAYS],
    ).fetchall()
    found: list[tuple[int, str, str]] = []
    kalshi = {e for v, _, e in pending if v == "kalshi"}
    for event in kalshi:
        for m in kalshi_query(f"event_ticker={event}"):
            r = kalshi_result(m)
            if r is not None:
                found.append((r, "kalshi", m["ticker"]))
    poly = [i for v, i, _ in pending if v == "polymarket"]
    for k in range(0, len(poly), 20):
        ids = "&".join(f"condition_ids={i}" for i in poly[k : k + 20])
        for m in get(f"{GAMMA}/markets?closed=true&{ids}"):
            r = polymarket_result(m)
            if r is not None:
                found.append((r, "polymarket", m["conditionId"]))
    with conn.transaction():
        cur = conn.cursor()
        cur.executemany(
            "update manta.predictions set result = %s"
            " where venue = %s and id = %s and result is null",
            found,
        )
    if cur.rowcount > 0:
        print(f"settled {cur.rowcount} predictions")
