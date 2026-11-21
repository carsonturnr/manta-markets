from datetime import UTC, datetime, timedelta

from manta_pricing.alerts import describe, evaluate, fires


def row(bid=0.40, ask=0.42, bid_size=500.0, ask_size=80.0, kalshi_mid=None, poly_mid=None):
    return dict(bid=bid, ask=ask, bid_size=bid_size, ask_size=ask_size,
                kalshi_mid=kalshi_mid, poly_mid=poly_mid)  # fmt: skip


def test_midpoint_crossings():
    # Midpoint (40 + 42) / 2 = 41¢.
    met, value = evaluate("above", 0.41, row())  # "at or above" includes 41¢
    assert met and abs(value - 0.41) < 1e-12
    assert evaluate("above", 0.42, row())[0] is False
    assert evaluate("below", 0.41, row())[0] is True
    assert evaluate("below", 0.40, row())[0] is False


def test_spread_counts_float_noise_as_equal():
    # 0.42 − 0.40 is 0.01999999… in floating point; it must still meet a 2¢ alert.
    met, value = evaluate("spread", 0.02, row())
    assert met and abs(value - 0.02) < 1e-12
    assert evaluate("spread", 0.03, row())[0] is False


def test_depth_is_the_smaller_side_and_an_empty_side_counts():
    assert evaluate("depth", 100, row()) == (True, 80.0)
    assert evaluate("depth", 80, row()) == (False, 80.0)  # "under" 80: 80 isn't
    assert evaluate("depth", 1, row(ask=None, ask_size=None)) == (True, None)


def test_no_quote_never_meets_a_price_alert():
    for kind in ("above", "below", "spread"):
        assert evaluate(kind, 0.01, row(ask=None, ask_size=None)) == (False, None)


def test_venues_gap():
    assert evaluate("venues", 0.05, row(kalshi_mid=0.30, poly_mid=0.355))[0] is True
    assert evaluate("venues", 0.05, row(kalshi_mid=0.30, poly_mid=0.34))[0] is False
    assert evaluate("venues", 0.05, row(kalshi_mid=0.30)) == (False, None)


def test_fires_once_when_the_condition_starts_and_at_most_hourly():
    now = datetime(2026, 11, 21, 12, 0, tzinfo=UTC)
    assert fires(True, False, None, now)
    assert not fires(True, True, None, now)  # already held at the last check
    assert not fires(False, False, None, now)
    assert not fires(True, False, now - timedelta(minutes=59), now)
    assert fires(True, False, now - timedelta(hours=1), now)


def test_descriptions_match_the_site():
    # site/lib/alerts.test.ts checks the same strings.
    assert describe("above", 0.6) == "Midpoint at or above 60¢"
    assert describe("spread", 0.025) == "Spread at least 2.5¢"
    assert describe("depth", 1500) == "Size at the best bid or ask under 1,500 contracts"
