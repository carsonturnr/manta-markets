from datetime import UTC, datetime
from math import sqrt

import pytest

from manta_pricing.fair import YEAR_S, norm_cdf
from manta_pricing.fairvalues import Crypto, bucket_mids, bucket_sum, fair_values
from manta_pricing.surface import Smile, Surface

NOW = datetime(2026, 11, 17, 16, 0, tzinfo=UTC).timestamp()
NOON = "2026-11-17T17:00:00Z"  # an hour from NOW: noon New York time


def flat(vol=0.5, fwd=65_000.0) -> Surface:
    """A surface with the same volatility at every strike: no smile, no correction term."""
    return Surface([Smile(NOW + 2 * 86400, fwd, [-1.0, 1.0], [vol, vol])])


def c(venue, family, cid, payoff, low=None, high=None, bid=None, ask=None, **kw):
    return {"venue": venue, "family": family, "id": cid, "event": kw.pop("event", family + "-E"),
            "payoff": payoff, "low": low, "high": high, "inclusive": kw.pop("inclusive", False),
            "close": kw.pop("close", NOON), "bid": bid, "ask": ask, **kw}  # fmt: skip


def at_the_money(tau_s: float, vol=0.5) -> float:
    # P(above K) with S = K, no smile: N(−√v/2), v = σ²·τ.
    v = vol * vol * tau_s / YEAR_S
    return norm_cdf(-sqrt(v) / 2)


def test_kalshi_and_polymarket_priced_on_their_own_settlement():
    crypto = {"BTC": Crypto(index=65_000.0, binance=65_000.0, surface=flat())}
    out = fair_values(
        [
            c("kalshi", "KXBTCD", "K", "above", low=65_000.0),
            c("polymarket", "btc-above", "P", "above", low=65_000.0),
        ],
        [],
        crypto,
        NOW,
    )
    # Kalshi: the 60-second average, so τ_eff = 3600 − 40 s. Polymarket: one close, τ = 3600 s.
    assert out[("kalshi", "K")] == pytest.approx((at_the_money(3560), "options"))
    assert out[("polymarket", "P")] == pytest.approx((at_the_money(3600), "options"))


def test_binance_premium_raises_polymarket():
    # Binance 0.1% above the index (measured 2026-11-16): Polymarket's "above $65,000" is worth
    # more than Kalshi's, which settles on the index.
    crypto = {"BTC": Crypto(index=65_000.0, binance=65_065.0, surface=flat())}
    out = fair_values(
        [
            c("kalshi", "KXBTCD", "K", "above", low=65_000.0),
            c("polymarket", "btc-above", "P", "above", low=65_000.0),
        ],
        [],
        crypto,
        NOW,
    )
    assert out[("polymarket", "P")][0] > out[("kalshi", "K")][0] + 0.05


def test_ether_and_fifteen_minute_contracts():
    crypto = {"ETH": Crypto(index=1_800.0, binance=None, surface=flat(0.6, 1_800.0))}
    soon = "2026-11-17T16:15:00Z"  # 15 minutes: the target is today's price, so about 50/50
    out = fair_values(
        [
            c("kalshi", "KXETH15M", "E15", "above", low=1_800.0, inclusive=True, close=soon),
            c("polymarket", "eth-above", "PE", "above", low=1_800.0),  # no Binance price: none
        ],
        [],
        crypto,
        NOW,
    )
    assert out[("kalshi", "E15")] == pytest.approx((at_the_money(900 - 40, 0.6), "options"))
    assert ("polymarket", "PE") not in out


def test_inside_the_averaging_window_has_no_fair():
    crypto = {"BTC": Crypto(index=65_000.0, binance=65_000.0, surface=flat())}
    close = datetime.fromtimestamp(NOW + 30, UTC).isoformat()
    out = fair_values(
        [c("kalshi", "KXBTCD", "K", "above", low=65_000.0, close=close)], [], crypto, NOW
    )
    assert out == {}


def test_cpi_two_venue_consensus():
    # Kalshi "above 0.2%" 30/32¢ and "above 0.3%" 10/12¢ and "above 0.1%" 60/62¢; Polymarket's
    # buckets for the same release. Linked by a pair, so one group, method "consensus-2".
    k = [
        c("kalshi", "KXCPI", f"K{x}", "above", low=x, bid=b, ask=b + 0.02, event="KXCPI-26NOV")
        for x, b in [(0.1, 0.60), (0.2, 0.30), (0.3, 0.10)]
    ]
    ev = "november-inflation-us-monthly"
    p = [
        c("polymarket", "cpi", "Plow", "below", high=0.1, inclusive=True, bid=0.38, ask=0.4,
          event=ev),
        c("polymarket", "cpi", "P0.2", "exact", low=0.2, high=0.2, bid=0.30, ask=0.32, event=ev),
        c("polymarket", "cpi", "P0.3", "exact", low=0.3, high=0.3, bid=0.18, ask=0.20, event=ev),
        c("polymarket", "cpi", "Phigh", "above", low=0.4, inclusive=True, bid=0.1, ask=0.12,
          event=ev),
    ]  # fmt: skip
    pairs = [
        {"kind": "bundle", "kalshi": {"ids": ["K0.2"]}, "polymarket": {"ids": ["P0.3", "Phigh"]}}
    ]
    out = fair_values(k + p, pairs, {}, NOW)
    assert {m for _, m in out.values()} == {"consensus-2"}
    # P(> 0.2): Kalshi says 31¢ (weight 1/0.02² = 2500). Polymarket's buckets ≥ 0.3 sum to
    # 19 + 11 = 30¢ (spreads 2 + 2 = 4¢: weight 625), and one minus its buckets ≤ 0.2 is
    # 1 − (39 + 31) = 30¢ (weight 625). Pooled: (0.31·2500 + 0.30·625 + 0.30·625)/3750 = 0.30667.
    assert out[("kalshi", "K0.2")][0] == pytest.approx(1150 / 3750)
    # A fair value is read off one curve, so the buckets and thresholds agree with each other:
    # P(CPI = 0.3) = P(> 0.2) − P(> 0.3).
    assert out[("polymarket", "P0.3")][0] == pytest.approx(
        out[("kalshi", "K0.2")][0] - out[("kalshi", "K0.3")][0]
    )


def test_single_venue_ladder_is_labelled_and_needs_three_strikes():
    two = [c("kalshi", "KXINXU", f"S{x}", "above", low=x, bid=0.5, ask=0.52) for x in (7000, 7100)]
    assert fair_values(two, [], {}, NOW) == {}
    three = two + [c("kalshi", "KXINXU", "S7200", "above", low=7200, bid=0.2, ask=0.22)]
    out = fair_values(three, [], {}, NOW)
    assert {m for _, m in out.values()} == {"consensus-1"}
    # Two strikes quoted the same and one lower: already falling, so each keeps its midpoint.
    assert out[("kalshi", "S7200")][0] == pytest.approx(0.21)


def test_fed_outcomes_sum_to_one_across_venues():
    ev = "KXFEDDECISION-26DEC"
    k = [
        c("kalshi", "KXFEDDECISION", "KH", "outcome", bid=0.04, ask=0.05, event=ev),
        c("kalshi", "KXFEDDECISION", "KU", "outcome", bid=0.88, ask=0.89, event=ev),
    ]
    p = [
        c("polymarket", "fed-decision", "PH", "outcome", bid=0.034, ask=0.036, event="fed-dec"),
        c("polymarket", "fed-decision", "PU", "outcome", bid=0.87, ask=0.88, event="fed-dec"),
    ]
    pairs = [
        {"kind": "same", "kalshi": {"ids": ["KH"]}, "polymarket": {"ids": ["PH"]}},
        {"kind": "same", "kalshi": {"ids": ["KU"]}, "polymarket": {"ids": ["PU"]}},
    ]
    out = fair_values(k + p, pairs, {}, NOW)
    assert out[("kalshi", "KH")] == out[("polymarket", "PH")]  # the same bet, one fair value
    assert out[("kalshi", "KH")][0] + out[("kalshi", "KU")][0] == pytest.approx(1)
    assert out[("kalshi", "KH")][1] == "consensus-2"


def test_unbid_buckets_count_as_zero_when_the_event_adds_up_past_a_dollar():
    # One live bucket at 30/32¢ (mid 31¢) and 40 with no bid offered at 2¢ (mid 1¢ each): the
    # midpoints add up to 71¢ + 40¢ = $1.11, past $1.10, so the unbid ones count as 0 and
    # P(> 2) reads 31¢, not 31 + 40 = 71¢.
    live = c("kalshi", "KXINX", "L", "between", low=2.0, high=3.0, bid=0.30, ask=0.32)
    low = c("kalshi", "KXINX", "B", "between", low=1.0, high=2.0, bid=0.39, ask=0.41)
    dead = [
        c("kalshi", "KXINX", f"D{i}", "between", low=3.0 + i, high=4.0 + i, ask=0.02)
        for i in range(40)
    ]
    cs = [low, live, *dead]
    mids = bucket_mids(cs)
    assert bucket_sum(2.0, [live, *dead], mids, from_top=True).p == pytest.approx(0.31)


def test_an_event_that_adds_up_keeps_every_midpoint():
    # 40¢ + 50¢ + an unbid bucket at 0/10¢ (mid 5¢) = 95¢: nothing is dropped.
    cs = [
        c("kalshi", "KXEURUSD", "A", "between", low=1.0, high=2.0, bid=0.39, ask=0.41),
        c("kalshi", "KXEURUSD", "B", "between", low=2.0, high=3.0, bid=0.49, ask=0.51),
        c("kalshi", "KXEURUSD", "C", "between", low=3.0, high=4.0, ask=0.10),
    ]
    assert bucket_mids(cs)["C"] == pytest.approx(0.05)
