"""A fair value for every contract in the minute's listing, labelled by method (step 5,
docs/product.md):

- "options": Bitcoin and Ether, from Deribit's options (fair.py, surface.py). Each venue is priced
  on what it settles on: Kalshi on the 60-second average of an index (Deribit's index stands in
  for CF Benchmarks'), Polymarket on one Binance 1-minute close, so on Binance's price and with no
  averaging. That is the adjustment the cross-venue pairs need: same strike and moment, different
  settlement price.
- "consensus-2" / "consensus-1": everything else, from the order books of both venues or one
  (consensus.py). One venue's consensus only makes its own ladder consistent; it adds no outside
  information, and the site says so.
- None: no usable quotes, outside the quoted strikes, or inside a crypto contract's final
  averaging window.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime

from manta_pricing.consensus import (
    Point,
    curve_at,
    falling_fit,
    mid_and_weight,
    normalized,
)
from manta_pricing.fair import AVERAGING_WINDOW_S, Quote, prob_above, prob_between
from manta_pricing.surface import Surface
from manta_pricing.table import DERIBIT, get

Fair = tuple[float, str]  # (probability, method)


@dataclass
class Crypto:
    """One currency's live inputs: Deribit's index (Kalshi's stand-in), Binance's price
    (Polymarket's settlement source) and Deribit's volatility surface."""

    index: float
    binance: float | None
    surface: Surface


# Family → (currency, settles on Binance?)
CRYPTO = {
    "KXBTCD": ("BTC", False),
    "KXBTC": ("BTC", False),
    "KXBTC15M": ("BTC", False),
    "KXETHD": ("ETH", False),
    "KXETH": ("ETH", False),
    "KXETH15M": ("ETH", False),
    "btc-above": ("BTC", True),
    "btc-price": ("BTC", True),
    "eth-above": ("ETH", True),
    "eth-price": ("ETH", True),
}

# Families priced by consensus over a ladder of strikes, with the step of their published value:
# CPI and unemployment are published to one decimal, so "≥ 3.3%" is "> 3.2%". Others are treated
# as continuous (payrolls are in thousands; index and FX levels finer still).
LADDERS = {
    "KXFED": 0.0,
    "KXCPI": 0.1,
    "KXCPIYOY": 0.1,
    "KXCPICORE": 0.1,
    "KXCPICOREYOY": 0.1,
    "KXU3": 0.1,
    "KXPAYROLLS": 0.0,
    "KXINX": 0.0,
    "KXINXU": 0.0,
    "KXNASDAQ100": 0.0,
    "KXNASDAQ100U": 0.0,
    "KXEURUSD": 0.0,
    "KXEURUSDH": 0.0,
    "KXUSDJPY": 0.0,
    "KXUSDJPYH": 0.0,
    "cpi": 0.1,
    "unemployment": 0.1,
    "payrolls": 0.0,
}
OUTCOMES = {"KXFEDDECISION", "fed-decision"}
MIN_POINTS = 3  # fewer quotes than this make no consensus worth showing
MAX_SPREAD = 0.20  # a threshold quote wider than this is no reading (informative)
MAX_OVERROUND = 0.10  # bucket midpoints adding up past $1.10: drop the unbid ones (bucket_mids)


BINANCE = (
    "https://data-api.binance.vision/api/v3"  # the public data host (the main one refuses US users)
)


def fetch_crypto(now: float) -> tuple[dict[str, Crypto], list[str]]:
    """Live inputs per currency, and what failed: a currency that fails is priced no further this
    minute; nothing else depends on it."""
    out, errors = {}, []
    for cur in ("BTC", "ETH"):
        try:
            index = get(f"{DERIBIT}/get_index_price?index_name={cur.lower()}_usd")["result"]
            summaries = get(f"{DERIBIT}/get_book_summary_by_currency?currency={cur}&kind=option")
            surface = Surface.from_deribit(summaries["result"], now)
        except Exception as e:  # noqa: BLE001 - any failure leaves this currency unpriced
            errors.append(f"deribit {cur}: {e}")
            continue
        try:
            binance = float(get(f"{BINANCE}/ticker/price?symbol={cur}USDT")["price"])
        except Exception as e:  # noqa: BLE001
            errors.append(f"binance {cur}: {e}")
            binance = None
        out[cur] = Crypto(index["index_price"], binance, surface)
    return out, errors


def ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def fair_values(
    contracts: list[dict], pairs: list[dict], crypto: dict[str, Crypto], now: float
) -> dict[tuple[str, str], Fair]:
    out: dict[tuple[str, str], Fair] = {}
    for c in contracts:
        if c["family"] in CRYPTO:
            f = options_fair(c, crypto, now)
            if f is not None:
                out[key(c)] = (f, "options")
    groups = event_groups(contracts, pairs)
    for members in groups:
        fams = {c["family"] for c in members}
        if fams & OUTCOMES:
            out.update(outcome_fairs(members, pairs))
        elif fams <= set(LADDERS):
            out.update(ladder_fairs(members))
    return out


def key(c: dict) -> tuple[str, str]:
    return c["venue"], c["id"]


# ---- Options ---------------------------------------------------------------------------------


def options_fair(c: dict, crypto: dict[str, Crypto], now: float) -> float | None:
    cur, binance = CRYPTO[c["family"]]
    inp = crypto.get(cur)
    if inp is None or (binance and inp.binance is None):
        return None
    spot = inp.binance if binance else inp.index
    window = 0.0 if binance else AVERAGING_WINDOW_S
    close = ts(c["close"])
    tau = close - now
    if tau <= max(window, 1.0):
        return None  # inside the averaging window, part of the average is already known

    def quote(k: float) -> Quote:
        s = inp.surface
        return Quote(spot, k, s.vol(k, close, now), s.vol_slope(k, close, now), tau, window)

    lo, hi = c.get("low"), c.get("high")
    match c["payoff"]:
        case "above" if lo:
            return prob_above(quote(lo))
        case "below" if hi:
            return 1 - prob_above(quote(hi))
        case "between" if lo and hi:
            return prob_between(quote(lo), quote(hi))
    return None


# ---- Grouping: one event, joined across venues by the cross-venue pairs ---------------------


def event_groups(contracts: list[dict], pairs: list[dict]) -> list[list[dict]]:
    """Contracts grouped by event; a Kalshi event and the Polymarket event a pair links it to
    form one group (step 4's pairs are the only cross-venue links)."""
    by_id = {key(c): c for c in contracts}
    parent: dict[tuple[str, str], tuple[str, str]] = {}

    def find(e):
        while parent.get(e, e) != e:
            e = parent[e]
        return e

    for p in pairs:
        k = by_id.get(("kalshi", p["kalshi"]["ids"][0]))
        q = by_id.get(("polymarket", p["polymarket"]["ids"][0]))
        if k and q:
            parent[find(("polymarket", q["event"]))] = find(("kalshi", k["event"]))
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in contracts:
        groups[find((c["venue"], c["event"]))].append(c)
    return list(groups.values())


def method(members: list[dict]) -> str:
    return "consensus-2" if len({c["venue"] for c in members}) > 1 else "consensus-1"


# ---- Outcomes: the Fed's decision ------------------------------------------------------------


def outcome_fairs(members: list[dict], pairs: list[dict]) -> dict[tuple[str, str], Fair]:
    """Each outcome's quotes from both venues (linked by the "same bet" pairs) combined, then
    scaled so the outcomes sum to 1."""
    same = {p["polymarket"]["ids"][0]: p["kalshi"]["ids"][0] for p in pairs if p["kind"] == "same"}
    outcome_of = {key(c): same.get(c["id"], c["id"]) for c in members}
    quotes: dict[str, list] = defaultdict(list)
    for c in members:
        quotes[outcome_of[key(c)]].append((c.get("bid"), c.get("ask")))
    probs = normalized(quotes)
    m = method(members)
    return {key(c): (probs[outcome_of[key(c)]], m) for c in members if outcome_of[key(c)] in probs}


# ---- Ladders ---------------------------------------------------------------------------------


def lower_edge(c: dict, step: float) -> float | None:
    """For a bucket, the x such that "value in this bucket or any above it" is "value > x"."""
    match c["payoff"]:
        case "exact":
            return c["low"] - step
        case "between":  # a range includes its lower bound (Kalshi's floor, Polymarket's rule)
            return c["low"] - step
        case "above":
            return c["low"] - step if c.get("inclusive") else c["low"]
    return None  # "below": the lowest bucket


def ladder_points(members: list[dict], step: float) -> list[Point]:
    """Readings of P(value > x) from one group's quotes. An event of thresholds gives one reading
    per contract. An event of buckets (ranges or exact values: together, every outcome) gives
    two readings per bucket edge e: the sum of the buckets above e, and one minus the sum of the
    buckets below it, each weighted by its own summed spread. Summing many thin buckets
    overstates them (their midpoints add up to more than $1), so each sum counts for less the
    more buckets and spread it adds up; near either end the short sum is tight and dominates."""
    points = []
    for _, cs in group_by(members, "event").items():
        if any(c["payoff"] in ("between", "exact") for c in cs):
            mids = bucket_mids(cs)
            buckets = [(lower_edge(c, step), c) for c in cs]
            edges = sorted({e for e, _ in buckets if e is not None})
            for e in edges:
                above = [c for x, c in buckets if x is not None and x >= e - 1e-9]
                below = [c for x, c in buckets if x is None or x < e - 1e-9]
                points.append(bucket_sum(e, above, mids, from_top=True))
                points.append(bucket_sum(e, below, mids, from_top=False))
        else:
            for c in cs:
                if not informative(c):
                    continue
                m, w = mid_and_weight(c.get("bid"), c.get("ask"))
                if c["payoff"] == "above":
                    x = c["low"] - step if c.get("inclusive") else c["low"]
                    points.append(Point(x, m, w))
                elif c["payoff"] == "below":
                    x = c["high"] if c.get("inclusive") else c["high"] - step
                    points.append(Point(x, 1 - m, w))
    return points


def informative(c: dict) -> bool:
    """Whether a threshold contract's quote says enough to be a reading of the curve. One with
    neither a bid nor an ask says nothing (read as 0 to 1, it would count as 50¢); one quoted
    wider than MAX_SPREAD says little more (3¢ bid, 45¢ ask: a 24¢ midpoint at every strike of a
    thin ladder, which the fit would report as a consensus)."""
    bid, ask = c.get("bid"), c.get("ask")
    if bid is None and ask is None:
        return False
    return (1.0 if ask is None else ask) - (0.0 if bid is None else bid) <= MAX_SPREAD + 1e-9


def bucket_mids(cs: list[dict]) -> dict[str, float]:
    """Each bucket's midpoint for summing. All of an event's buckets together are worth exactly
    $1. When their midpoints add up to more than $1 + MAX_OVERROUND, the excess sits in buckets
    nobody bids on (offered at 1–3¢, hundreds of them in Kalshi's $5 Ether ranges), and those
    count as 0: their price is somewhere between 0 and the ask, and summed by the hundred any
    positive guess invents probability (300 Ether buckets, 8 with a bid, read as 317% a year).
    An event that already adds up (EUR/USD's 15 buckets: 99.5¢) keeps every midpoint."""
    mids = {c["id"]: mid_and_weight(c.get("bid"), c.get("ask"))[0] for c in cs}
    if sum(mids.values()) > 1 + MAX_OVERROUND:
        for c in cs:
            if not c.get("bid"):
                mids[c["id"]] = 0.0
    return mids


def bucket_sum(e: float, buckets: list[dict], mids: dict[str, float], from_top: bool) -> Point:
    """P(value > e) read from a set of buckets: their total (from the top) or one minus it (from
    the bottom), weighted 1/(sum of their spreads)²."""
    mid = sum(mids[c["id"]] for c in buckets)
    spread = sum(max((c.get("ask") or 1.0) - (c.get("bid") or 0.0), 0.01) for c in buckets)
    p = min(mid, 1.0) if from_top else max(1.0 - mid, 0.0)
    return Point(e, p, 1 / spread**2)


def ladder_fairs(members: list[dict]) -> dict[tuple[str, str], Fair]:
    step = max(LADDERS[c["family"]] for c in members)
    points = ladder_points(members, step)
    if len({p.x for p in points}) < MIN_POINTS:
        return {}
    fit = falling_fit(points)
    m = method(members)
    out = {}
    for c in members:
        f = ladder_fair(c, fit, step)
        if f is not None:
            out[key(c)] = (min(1.0, max(0.0, f)), m)
    return out


def ladder_fair(c: dict, fit: list[Point], step: float) -> float | None:
    def at(x: float) -> float | None:
        return curve_at(fit, x)

    lo, hi = c.get("low"), c.get("high")
    match c["payoff"]:
        case "above":
            return at(lo - step if c.get("inclusive") else lo)
        case "below":
            v = at(hi if c.get("inclusive") else hi - step)
            return None if v is None else 1 - v
        case "between":  # Kalshi: floor to cap, both included; Polymarket: [low, high)
            a = at(lo - step)
            b = at(hi if c["venue"] == "kalshi" else hi - step)
            return None if a is None or b is None else a - b
        case "exact":
            a, b = at(lo - step), at(lo)
            return None if a is None or b is None else a - b
    return None


def group_by(cs: list[dict], field: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for c in cs:
        out[c[field]].append(c)
    return out
