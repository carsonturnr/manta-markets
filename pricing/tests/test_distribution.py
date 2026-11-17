from math import log, sqrt
from statistics import NormalDist

import pytest

from manta_pricing.consensus import Point
from manta_pricing.distribution import (
    YEAR_S,
    distributions,
    implied_vol,
    moments,
    quantile,
)
from manta_pricing.fairvalues import ts


def curve(*xp):
    return [Point(x, p, 1.0) for x, p in xp]


FIT = curve((1, 0.9), (2, 0.6), (3, 0.2), (4, 0.05))


def test_quantiles_by_hand():
    # Median: P(> x) = 0.5 between (2, 0.6) and (3, 0.2): 2 + (0.6 − 0.5) / 0.4 = 2.25.
    assert quantile(FIT, 0.5) == pytest.approx(2.25)
    # 25th percentile: P(> x) = 0.75 between (1, 0.9) and (2, 0.6): 1 + 0.15 / 0.3 = 1.5.
    assert quantile(FIT, 0.25) == pytest.approx(1.5)
    # 75th: P(> x) = 0.25: 2 + 0.35 / 0.4 = 2.875.
    assert quantile(FIT, 0.75) == pytest.approx(2.875)


def test_quantile_outside_the_quoted_strikes_is_none():
    assert quantile(FIT, 0.05) is None  # P(> x) = 0.95 is above the first strike's 0.9
    assert quantile(FIT, 0.99) is None


def test_quantile_of_a_stepped_value_is_a_published_value():
    # CPI in steps of 0.1: P(> x) = 0.5 at 3.0 + 0.1 · 0.4 / 0.5 = 3.08, so the median print is
    # 3.1 (P(print ≤ 3.0) = 0.1, P(print ≤ 3.1) = 0.6).
    fit = curve((3.0, 0.9), (3.1, 0.4), (3.2, 0.1))
    assert quantile(fit, 0.5, step=0.1) == pytest.approx(3.1)


def test_moments_by_hand():
    # Tails 3% each (≤ 5%). Masses: 0.03 at 0.5, 0.47 at 1.5, 0.47 at 2.5, 0.03 at 3.5.
    # Mean 2 by symmetry; variance 2 · (0.03 · 1.5² + 0.47 · 0.5²) = 0.135 + 0.235 = 0.37.
    mean, sd = moments(curve((1, 0.97), (2, 0.5), (3, 0.03)))
    assert mean == pytest.approx(2.0)
    assert sd == pytest.approx(sqrt(0.37))


def test_moments_of_a_stepped_value_sit_on_published_values():
    # Ranges (2.9, 3.0], (3.0, 3.1], (3.1, 3.2], (3.2, 3.3] hold one print each: 3.0, 3.1, 3.2,
    # 3.3, with 0.02, 0.48, 0.48, 0.02. Mean 3.15; variance 2 · (0.02 · 0.15² + 0.48 · 0.05²).
    mean, sd = moments(curve((3.0, 0.98), (3.1, 0.5), (3.2, 0.02)), step=0.1)
    assert mean == pytest.approx(3.15)
    assert sd == pytest.approx(sqrt(2 * (0.02 * 0.15**2 + 0.48 * 0.05**2)))


def test_no_moments_with_a_heavy_tail():
    assert moments(FIT) is None  # 10% below the first strike


def test_implied_vol_by_hand():
    # σ = 50% over a year: ln(value) has an interquartile range of 1.349 · 0.5 = 0.6745.
    q25, q75 = 100 * 2.718281828 ** (-0.33725), 100 * 2.718281828**0.33725
    assert implied_vol(q25, q75, YEAR_S) == pytest.approx(0.5, rel=1e-4)
    assert implied_vol(0, 1, YEAR_S) is None


def test_implied_vol_recovers_a_lognormal_ladder():
    # A ladder priced exactly by the options model's log-normal (σ 50%, one day, spot 100,000,
    # strikes every $250): the quartiles read off the curve give back σ within 1%.
    sigma, tau = 0.5, 24 * 3600
    s = sigma * sqrt(tau / YEAR_S)
    nd = NormalDist()
    fit = curve(*[(k, 1 - nd.cdf(log(k / 100_000) / s)) for k in range(95_000, 105_001, 250)])
    v = implied_vol(quantile(fit, 0.25), quantile(fit, 0.75), tau)
    assert v == pytest.approx(sigma, rel=0.01)


def contract(event, low, bid, ask, family="KXBTCD", venue="kalshi", payoff="above"):
    return {
        "venue": venue, "id": f"{event}-{low}", "family": family, "event": event,
        "title": "Bitcoin at 5pm", "close": "2026-11-17T22:00:00Z", "payoff": payoff,
        "low": low, "high": None, "inclusive": False, "bid": bid, "ask": ask,
    }  # fmt: skip


def test_distributions_one_crypto_event():
    now = ts("2026-11-17T22:00:00Z") - 24 * 3600  # one day before the close
    ladder = [
        contract("E", 98_000, 0.89, 0.91),
        contract("E", 99_000, 0.69, 0.71),
        contract("E", 100_000, 0.49, 0.51),
        contract("E", 101_000, 0.29, 0.31),
        contract("E", 102_000, 0.09, 0.11),
    ]
    [d] = distributions(ladder, [], {}, now)
    assert (d.venue, d.method) == ("kalshi", "consensus-1")
    assert d.median == pytest.approx(100_000)
    # Quartiles where P(> x) = 0.75 and 0.25: 98,000 + 1,000 · 0.15 / 0.2 = 98,750 and
    # 101,000 + 1,000 · 0.05 / 0.2 = 101,250.
    assert (d.q25, d.q75) == (pytest.approx(98_750), pytest.approx(101_250))
    assert d.vol == pytest.approx(log(101_250 / 98_750) / (1.349 * sqrt(1 / 365.25)))
    assert d.mean is None  # 10% below 98,000 and 10% above 102,000
    assert d.deribit_vol is None  # no Deribit surface given
    assert d.spread == pytest.approx(0.02)
    # Ten minutes before the close: left out.
    assert distributions(ladder, [], {}, ts("2026-11-17T21:50:00Z")) == []


def test_too_few_strikes_and_economics_have_no_vol():
    cpi = [
        contract("C", 3.0, 0.80, 0.84, family="KXCPIYOY"),
        contract("C", 3.1, 0.40, 0.44, family="KXCPIYOY"),
        contract("C", 3.2, 0.10, 0.14, family="KXCPIYOY"),
    ]
    short = [contract("S", 1, 0.5, 0.6), contract("S", 2, 0.3, 0.4)]
    [d] = distributions(cpi + short, [], {}, 0.0)
    assert d.family == "KXCPIYOY"
    assert d.median == pytest.approx(3.1)
    assert d.vol is None


def test_no_vol_when_the_ladder_is_too_coarse():
    # Strikes $2,000 apart, 95% / 50% / 5%: only one strike inside the middle 50%, so the
    # quartiles are interpolated between strikes and say nothing about volatility.
    now = ts("2026-11-17T22:00:00Z") - 3600
    ladder = [
        contract("P", 62_000, 0.94, 0.96),
        contract("P", 64_000, 0.49, 0.51),
        contract("P", 66_000, 0.04, 0.06),
    ]
    [d] = distributions(ladder, [], {}, now)
    assert d.median == pytest.approx(64_000)
    assert d.vol is None
