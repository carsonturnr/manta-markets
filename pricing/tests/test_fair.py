from math import exp, log, sqrt

import pytest

from manta_pricing.fair import (
    AVERAGING_WINDOW_S,
    YEAR_S,
    Quote,
    effective_seconds,
    norm_cdf,
    prob_above,
    prob_between,
)

HOUR = 3600.0


def q(strike, tau_s=HOUR, vol=0.5, slope=0.0, spot=70_000.0):
    return Quote(spot=spot, strike=strike, vol=vol, vol_slope=slope, tau_s=tau_s)


def test_worked_example_by_hand():
    # S = K = $70,000, σ = 50%/year, 1 hour to close.
    # τ_eff = 3600 − 2·60/3 = 3560 s = 3560 / 31,557,600 yr = 1.12809e-4 yr
    # v = 0.25 × 1.12809e-4 = 2.82023e-5, √v = 5.31058e-3
    # d2 = (ln 1 − v/2)/√v = −√v/2 = −2.65529e-3, N(d2) = 0.5 − 2.65529e-3·0.398942 = 0.498941
    assert prob_above(q(70_000)) == pytest.approx(0.498941, abs=1e-6)
    # 1% below the money: d2 = (ln(70000/69300) − v/2)/√v = (0.0100503 − 1.41e-5)/5.31058e-3
    #   = 1.88988 → N = 0.970611
    assert prob_above(q(69_300)) == pytest.approx(0.970611, abs=2e-5)


def test_limits():
    # At the window's start 20 s of effective time remain: at the money, a hair under a coin flip
    # (the log-normal median sits just below the price).
    assert prob_above(q(70_000, tau_s=AVERAGING_WINDOW_S)) == pytest.approx(0.5, abs=1e-4)
    assert prob_above(q(10_000)) == pytest.approx(1.0)
    assert prob_above(q(500_000)) == pytest.approx(0.0, abs=1e-12)


def test_decreasing_in_strike_and_ranges_sum_to_one():
    strikes = [60_000 + 250 * i for i in range(81)]  # 60,000 … 80,000
    ps = [prob_above(q(k)) for k in strikes]
    assert all(a >= b for a, b in zip(ps, ps[1:], strict=False))
    ladder = [prob_between(q(a), q(b)) for a, b in zip(strikes, strikes[1:], strict=False)]
    assert all(x >= 0 for x in ladder)
    # Below 60,000 + the ladder + above 80,000 covers every outcome.
    total = (1 - ps[0]) + sum(ladder) + ps[-1]
    assert total == pytest.approx(1.0, abs=1e-12)


def test_averaging_window_cuts_two_thirds_of_it():
    assert effective_seconds(3600) == 3600 - 40
    assert effective_seconds(60) == 20
    with pytest.raises(ValueError, match="inside the averaging window"):
        effective_seconds(59)


def test_averaging_matters_near_the_close():
    # 2 minutes out, a single price would vary over 120 s; the average only over 80 s.
    k, tau = 70_200, 120.0
    t_avg = effective_seconds(tau) / YEAR_S
    t_spot = tau / YEAR_S
    by_hand = lambda t: norm_cdf((log(70_000 / k) - 0.125 * t) / (0.5 * sqrt(t)))  # noqa: E731
    assert prob_above(q(k, tau_s=tau)) == pytest.approx(by_hand(t_avg), rel=1e-12)
    assert prob_above(q(k, tau_s=tau)) < by_hand(t_spot)  # less spread: further-out K less likely


def test_smile_correction_sign():
    flat = prob_above(q(72_000))
    skewed = prob_above(q(72_000, slope=-2e-6))  # σ falls 0.2 vol points per $1,000 of strike
    assert skewed > flat
    # The correction is exactly vega × slope.
    t = effective_seconds(HOUR) / YEAR_S
    v = 0.25 * t
    d1 = (log(70_000 / 72_000) + v / 2) / sqrt(v)
    vega = 70_000 * exp(-0.5 * d1 * d1) / sqrt(2 * 3.141592653589793) * sqrt(t)
    assert skewed - flat == pytest.approx(vega * 2e-6, rel=1e-9)
