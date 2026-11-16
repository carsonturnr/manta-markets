import pytest

from manta_pricing.liquidity import is_active, samples


def c(family, bid, ask, bs=10.0, asz=20.0, venue="kalshi"):
    return {
        "venue": venue,
        "family": family,
        "bid": bid,
        "ask": ask,
        "bid_size": bs,
        "ask_size": asz,
    }


def test_active_excludes_one_sided_and_far_strikes():
    assert is_active(c("F", 0.40, 0.42))
    assert not is_active(c("F", None, 0.01))  # no bid
    assert not is_active(c("F", 0.01, 0.02))  # midpoint 1.5¢: a far strike
    assert not is_active(c("F", 0.98, 0.99))


def test_samples_by_hand():
    rows = samples(
        [
            c("KXCPI", 0.40, 0.42, 10, 20),  # spread 2¢, size min(10, 20) = 10
            c("KXCPI", 0.50, 0.55, 300, 100),  # 5¢, 100
            c("KXCPI", 0.60, 0.61, 5, 7),  # 1¢, 5
            c("KXCPI", None, 0.01),  # inactive: counted, not measured
        ]
    )
    assert rows == [("kalshi", "KXCPI", 4, 3, pytest.approx(0.02), 10)]


def test_family_with_nothing_active():
    assert samples([c("KXU3", None, 0.01)]) == [("kalshi", "KXU3", 1, 0, None, None)]
