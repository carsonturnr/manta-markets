"""Implied distributions and volatility term structure (step 7, docs/product.md).

A ladder of contracts on one number is the market's probability distribution for it. Step 5's
consensus fit (consensus.py) already gives the falling curve S(x) = P(value > x) at each quoted
strike; this module reads that curve:

- probability between two strikes a < b: S(a) − S(b);
- quantiles: the q-th quantile is where S(x) = 1 − q (median: S = 0.5; quartiles: 0.75, 0.25),
  linear between strikes, None outside the quoted strikes. A value published in steps (CPI to
  0.1) has a published value as its quantile: the next one at or above;
- mean and standard deviation, as if each range's probability sat at its centre. The tails below
  the first strike and above the last have no centre, so these are given only when each tail
  holds at most 5%, treated as one more range as wide as the nearest gap;
- implied volatility, for prices (crypto, stock indexes, FX): if ln(value) is normally
  distributed, as the options model assumes, its interquartile range is 1.349·σ·√T. So
  σ = (ln q75 − ln q25) / (1.349·√T), with T the time to close in years. Quartiles sit near the
  current price, where quotes are tightest, so this needs no assumption about the tails. One
  number per close time gives the term structure: volatility by horizon. It is given only when
  at least two quoted strikes fall inside the middle 50%: otherwise the quartiles are just
  interpolated between two strikes and measure the ladder's spacing (Polymarket's $2,000 steps
  against a 40-minute middle 50% of a few hundred dollars read as 260%).

Pure math on floats; no data access.
"""

from collections import defaultdict
from dataclasses import dataclass
from math import ceil, log, sqrt
from statistics import median

from manta_pricing.consensus import Point, falling_fit
from manta_pricing.fair import YEAR_S
from manta_pricing.fairvalues import CRYPTO, LADDERS, Crypto, event_groups, ladder_points, ts

MAX_TAIL = 0.05  # largest tail probability for which a mean is given
IQR_SIGMAS = 1.349  # a normal distribution's interquartile range, in standard deviations
MIN_STRIKES = 3
# An event this close to its close is left out: nearly every contract is already at 0 or 1¢ and
# the "distribution" is a point (Bitcoin's 02:00 ranges, 2 minutes out: 187 buckets, 1 live).
MIN_TAU_S = 15 * 60
MIN_INSIDE = 2  # quoted strikes inside the middle 50% for an implied volatility
# Families quoted on a price, where an implied volatility means something (not CPI or payrolls).
PRICES = {f for f in CRYPTO} | {"KXINX", "KXINXU", "KXNASDAQ100", "KXNASDAQ100U", "KXEURUSD",
                                "KXEURUSDH", "KXUSDJPY", "KXUSDJPYH"}  # fmt: skip


def quantile(fit: list[Point], q: float, step: float = 0.0) -> float | None:
    """The x where the curve P(value > x) falls to 1 − q; None outside the quoted strikes."""
    level = 1 - q
    for a, b in zip(fit, fit[1:], strict=False):
        if a.p >= level >= b.p:
            x = a.x if a.p == b.p else a.x + (b.x - a.x) * (a.p - level) / (a.p - b.p)
            return ceil(round(x / step, 9)) * step if step else x
    return None


def moments(fit: list[Point], step: float = 0.0) -> tuple[float, float] | None:
    """Mean and standard deviation, each range's probability at its centre, or None when a tail
    holds more than MAX_TAIL. A range (a, b] of published values in steps of `step` has the values
    a + step … b, centred at (a + step + b) / 2; with step 0 that is the midpoint."""
    if len(fit) < 2 or 1 - fit[0].p > MAX_TAIL or fit[-1].p > MAX_TAIL:
        return None

    def centre(a: float, b: float) -> float:
        return (a + step + b) / 2

    # The tails as one more range of the nearest gap's width beyond each edge.
    first, last = fit[1].x - fit[0].x, fit[-1].x - fit[-2].x
    masses = [(1 - fit[0].p, centre(fit[0].x - first, fit[0].x))]
    masses += [(a.p - b.p, centre(a.x, b.x)) for a, b in zip(fit, fit[1:], strict=False)]
    masses.append((fit[-1].p, centre(fit[-1].x, fit[-1].x + last)))
    total = sum(m for m, _ in masses)
    mean = sum(m * x for m, x in masses) / total
    var = sum(m * (x - mean) ** 2 for m, x in masses) / total
    return mean, sqrt(var)


def implied_vol(q25: float, q75: float, tau_s: float) -> float | None:
    """Annualized volatility from the quartiles of a price's distribution, tau_s seconds ahead."""
    if q25 <= 0 or q75 <= q25 or tau_s <= 0:
        return None
    return log(q75 / q25) / (IQR_SIGMAS * sqrt(tau_s / YEAR_S))


@dataclass
class Distribution:
    venue: str  # "kalshi", "polymarket" or "both"
    family: str
    event: str
    title: str
    close: str
    method: str  # "consensus-2" or "consensus-1", as for fair values
    curve: list[tuple[float, float]]  # (x, P(value > x)), the fitted curve
    median: float | None
    q25: float | None
    q75: float | None
    mean: float | None
    sd: float | None
    vol: float | None  # implied by the quartiles, annualized (prices only)
    deribit_vol: float | None  # Deribit's at-the-money volatility at the same close (crypto)
    spread: float | None  # median bid–ask spread of the ladder's two-sided quotes: how thin it is


def distributions(
    contracts: list[dict], pairs: list[dict], crypto: dict[str, Crypto], now: float
) -> list[Distribution]:
    """One distribution per ladder event. Economics and index ladders are grouped across venues
    as for fair values (so the two always agree); crypto ladders are read per venue, since Kalshi
    and Polymarket settle on different prices at different times."""
    ladders = [c for c in contracts if c["family"] in LADDERS]
    groups = event_groups(ladders, pairs)
    by_event: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in contracts:
        if c["family"] in CRYPTO:
            by_event[(c["venue"], c["event"])].append(c)
    groups += list(by_event.values())
    out = []
    for members in groups:
        d = distribution(members, crypto, now)
        if d is not None:
            out.append(d)
    return sorted(out, key=lambda d: (d.family, d.close, d.venue))


def distribution(members: list[dict], crypto: dict[str, Crypto], now: float) -> Distribution | None:
    step = max((LADDERS.get(c["family"], 0.0) for c in members), default=0.0)
    # Kalshi's member names the event when both venues are in it.
    first = min(members, key=lambda c: (c["venue"] != "kalshi", c["family"]))
    close = first["close"]
    tau = ts(close) - now
    if tau < MIN_TAU_S or any(c["payoff"] == "outcome" for c in members):
        return None
    fit = falling_fit(ladder_points(members, step))
    if len(fit) < MIN_STRIKES:
        return None
    venues = sorted({c["venue"] for c in members})
    spreads = [c["ask"] - c["bid"] for c in members if c.get("bid") and c.get("ask")]
    q25, q50, q75 = (quantile(fit, q, step) for q in (0.25, 0.5, 0.75))
    m = moments(fit, step)
    vol = deribit = None
    inside = sum(1 for p in fit if 0.25 < p.p < 0.75)
    if first["family"] in PRICES and q25 is not None and q75 is not None and inside >= MIN_INSIDE:
        vol = implied_vol(q25, q75, tau)
    if first["family"] in CRYPTO and q50 is not None and tau > 0:
        inp = crypto.get(CRYPTO[first["family"]][0])
        if inp is not None:
            deribit = inp.surface.vol(inp.index, ts(close), now)
    return Distribution(
        venue=venues[0] if len(venues) == 1 else "both",
        family=first["family"],
        event=first["event"],
        title=first["title"],
        close=close,
        method="consensus-2" if len(venues) > 1 else "consensus-1",
        curve=[(p.x, p.p) for p in fit],
        median=q50,
        q25=q25,
        q75=q75,
        mean=m[0] if m else None,
        sd=m[1] if m else None,
        vol=vol,
        deribit_vol=deribit,
        spread=median(spreads) if spreads else None,
    )
