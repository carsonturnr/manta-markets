"""Fair probability for Kalshi's Bitcoin contracts (docs/milestone-2-pricing.md).

A KXBTCD contract pays $1 if the average of the BTC index over the 60 seconds before the close
is above a strike K. This module turns "BTC price now, volatility, time to close" into that
probability. Everything is plain math on floats; no data access.

Terms:
- volatility σ: how much BTC tends to move, as a fraction per √year (0.5 = 50%/year);
- variance: σ² × time, the quantity that adds up over time;
- N(x): the standard normal cumulative distribution (the bell curve's area left of x).
"""

from dataclasses import dataclass
from math import erf, exp, log, pi, sqrt

YEAR_S = 365.25 * 24 * 3600
AVERAGING_WINDOW_S = 60.0  # Kalshi settles on the 60-second average before the close


def norm_cdf(x: float) -> float:
    """N(x): the probability a standard normal variable is below x."""
    return 0.5 * (1 + erf(x / sqrt(2)))


def norm_pdf(x: float) -> float:
    """The bell curve's height at x."""
    return exp(-0.5 * x * x) / sqrt(2 * pi)


def effective_seconds(tau_s: float, window_s: float = AVERAGING_WINDOW_S) -> float:
    """Time that matters for an average over the final `window_s` seconds before a close
    `tau_s` seconds away.

    The average of a random walk over its last w seconds varies like a single price at
    τ − 2w/3: the first τ − w seconds count fully, and the averaged stretch counts a third
    (the variance of an average of a random walk over w is w/3). Only valid for τ ≥ w: inside
    the window, part of the average is already known.
    """
    if tau_s < window_s:
        raise ValueError(f"{tau_s:.0f}s to close: inside the averaging window")
    return tau_s - 2 * window_s / 3


@dataclass(frozen=True)
class Quote:
    """Model inputs for one strike: today's price S, the strike's volatility, the smile's slope
    there (dσ/dK, per dollar), the time to close in seconds, and the averaging window the venue
    settles on (Kalshi: 60 s; Polymarket's single 1-minute candle close: 0)."""

    spot: float
    strike: float
    vol: float
    vol_slope: float
    tau_s: float
    window_s: float = AVERAGING_WINDOW_S


def prob_above(q: Quote) -> float:
    """P(the settlement value > strike), with the smile correction. The settlement value is the
    average over the final `window_s` seconds (Kalshi), or the price at the close if 0.

    Log-normal model: P = N(d2), with d2 = (ln(S/K) − v/2)/√v and v = σ² × τ_eff (in years).

    Smile correction. The chance of finishing above K equals how fast a call's price falls as its
    strike rises: P = −dC/dK. When σ itself changes with K, that derivative has two parts: the
    plain N(d2), and the effect of the strike's volatility changing, vega × dσ/dK. vega =
    S·n(d1)·√τ is a call's price change (in $) per unit of σ, and dσ/dK is per $, so the
    product is a probability. With the usual downside skew (σ falls as K rises), the correction
    raises the "above" probability.
    """
    t = effective_seconds(q.tau_s, q.window_s) / YEAR_S
    v = q.vol * q.vol * t
    if v <= 0:
        return 1.0 if q.spot > q.strike else 0.0
    sd = sqrt(v)
    d1 = (log(q.spot / q.strike) + v / 2) / sd
    d2 = d1 - sd
    vega = q.spot * norm_pdf(d1) * sqrt(t)
    p = norm_cdf(d2) - vega * q.vol_slope
    return min(1.0, max(0.0, p))


def prob_between(low: Quote, high: Quote) -> float:
    """P(low.strike < average ≤ high.strike): the difference of two "above" probabilities,
    each at its own strike's volatility. Never negative."""
    return max(0.0, prob_above(low) - prob_above(high))
