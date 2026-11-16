"""Liquidity statistics (step 6b, docs/product.md): one summary per contract family every 15
minutes, from the minute's listing, so the site can show when each market is cheapest to trade.

Only "active" contracts count: quoted on both sides, with a midpoint between 5¢ and 95¢. Strikes
far from the price sit at 0/1¢ or 99¢/no ask and would drown every median.

- spread: the median ask − bid among active contracts;
- size: the median of the smaller of the best bid's and best ask's sizes (what a round trip can
  use at the best prices), in contracts.
"""

from statistics import median

EVERY_MIN = 15  # sample on minutes divisible by this
ACTIVE = (0.05, 0.95)


def is_active(c: dict) -> bool:
    b, a = c.get("bid"), c.get("ask")
    return b is not None and a is not None and ACTIVE[0] <= (a + b) / 2 <= ACTIVE[1]


def samples(contracts: list[dict]) -> list[tuple]:
    """(venue, family, contracts, active, median spread, median size) per family; the spread and
    size are None for a family with no active contract."""
    fams: dict[tuple[str, str], list[dict]] = {}
    for c in contracts:
        fams.setdefault((c["venue"], c["family"]), []).append(c)
    out = []
    for (venue, family), cs in sorted(fams.items()):
        act = [c for c in cs if is_active(c)]
        spread = median(c["ask"] - c["bid"] for c in act) if act else None
        sizes = [min(c["bid_size"], c["ask_size"]) for c in act if c["bid_size"] and c["ask_size"]]
        out.append((venue, family, len(cs), len(act), spread, median(sizes) if sizes else None))
    return out
