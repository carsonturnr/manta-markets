import pytest

from manta_pricing.consensus import Point, curve_at, falling_fit, mid_and_weight, normalized


def test_mid_and_weight():
    # 40/42¢: mid 41¢, spread 2¢ → weight 1/0.02² = 2500.
    assert mid_and_weight(0.40, 0.42) == pytest.approx((0.41, 2500))
    # No bid: counts as 0; no ask: as 1. 0/10¢ → mid 5¢, weight 100.
    assert mid_and_weight(None, 0.10) == pytest.approx((0.05, 100))
    assert mid_and_weight(None, None) == pytest.approx((0.5, 1))
    # A locked quote counts as one tick wide, not infinitely precise.
    assert mid_and_weight(0.5, 0.5)[1] == pytest.approx(10_000)


def test_falling_fit_by_hand():
    # Above 4.0%: 50¢ (w 1); above 4.1%: 60¢ (w 3), out of order; above 4.2%: 20¢ (w 1).
    # 4.1% is above 4.0%, so the two merge at their weighted average (0.5·1 + 0.6·3)/4 = 0.575,
    # which is above 4.2%'s 0.20: in order, done.
    fit = falling_fit([Point(4.0, 0.5, 1), Point(4.1, 0.6, 3), Point(4.2, 0.2, 1)])
    assert [p.p for p in fit] == pytest.approx([0.575, 0.575, 0.2])
    assert [p.x for p in fit] == [4.0, 4.1, 4.2]


def test_falling_fit_merges_backwards():
    # 0.3, 0.2, 0.4 (equal weights): 0.4 > 0.2 merges to 0.3, which then ties 0.3: no further
    # merge needed (equal is falling enough).
    fit = falling_fit([Point(1, 0.3, 1), Point(2, 0.2, 1), Point(3, 0.4, 1)])
    assert [p.p for p in fit] == pytest.approx([0.3, 0.3, 0.3])
    # 0.3, 0.2, 0.6: 0.6 merges with 0.2 → 0.4, then above 0.3 → all three at 0.3667.
    fit = falling_fit([Point(1, 0.3, 1), Point(2, 0.2, 1), Point(3, 0.6, 1)])
    assert [p.p for p in fit] == pytest.approx([1.1 / 3] * 3)


def test_falling_fit_leaves_a_falling_ladder_alone():
    pts = [Point(x, p, 1) for x, p in [(1, 0.9), (2, 0.6), (3, 0.1)]]
    assert [p.p for p in falling_fit(pts)] == pytest.approx([0.9, 0.6, 0.1])


def test_same_x_pooled():
    # Kalshi and Polymarket both quote "above 0.2%": 30¢ (w 1) and 40¢ (w 4) → 0.38, one point.
    fit = falling_fit([Point(0.2, 0.3, 1), Point(0.2, 0.4, 4)])
    assert [(p.x, p.p) for p in fit] == [(0.2, pytest.approx(0.38))]
    # Already "falling" in list order (58¢ then 42¢) must pool too: the bug of 2026-11-16, where
    # reading the curve at 3.7 returned the first of the two (Polymarket's thin bundle, 58¢).
    fit = falling_fit([Point(3.6, 0.815, 10_000), Point(3.7, 0.583, 55), Point(3.7, 0.42, 625)])
    assert curve_at(fit, 3.7) == pytest.approx((0.583 * 55 + 0.42 * 625) / 680)


def test_float_strikes_pooled():
    # 4.1 − 0.1 is 3.9999999999999996 in floating point: the same strike as 4.0.
    fit = falling_fit([Point(4.1 - 0.1, 0.03, 1), Point(4.0, 0.01, 1)])
    assert len(fit) == 1 and fit[0].p == pytest.approx(0.02)


def test_curve_at():
    fit = [Point(1, 0.8, 1), Point(3, 0.2, 1)]
    assert curve_at(fit, 2) == pytest.approx(0.5)  # halfway
    assert curve_at(fit, 1) == pytest.approx(0.8)
    assert curve_at(fit, 0.5) is None  # no extrapolation
    assert curve_at(fit, 3.5) is None


def test_normalized_fed():
    # Kalshi 4/5¢ and Polymarket 3.4/3.6¢ on "No change"; 88/89 and 87/88 on "Hike 25".
    out = normalized(
        {
            "hold": [(0.04, 0.05), (0.034, 0.036)],
            "hike25": [(0.88, 0.89), (0.87, 0.88)],
            "hike50": [(0.08, 0.09)],
        }
    )
    assert sum(out.values()) == pytest.approx(1)
    # hold: Kalshi 4.5¢ w 10,000, Polymarket 3.5¢ w 10,000 (both floored at one tick) → 4.0¢
    raw = {"hold": 0.04, "hike25": (0.885 + 0.875) / 2, "hike50": 0.085}
    s = sum(raw.values())
    assert out["hold"] == pytest.approx(0.04 / s)
