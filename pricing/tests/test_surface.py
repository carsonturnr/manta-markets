from datetime import UTC, datetime
from math import log, sqrt

import pytest

from manta_pricing.surface import Smile, Surface, parse_instrument

NOW = datetime(2026, 11, 13, 12, tzinfo=UTC).timestamp()
D1 = datetime(2026, 11, 14, 8, tzinfo=UTC).timestamp()  # 20 h out
D2 = datetime(2026, 11, 15, 8, tzinfo=UTC).timestamp()  # 44 h out


def test_parse_instrument():
    assert parse_instrument("BTC-14NOV26-72000-C") == (D1, 72000.0, "C")
    assert parse_instrument("BTC-5DEC26-100000-P")[1:] == (100000.0, "P")


def test_smile_interpolates_in_log_moneyness_and_holds_edges():
    s = Smile(D1, 70_000, [log(0.9), log(1.0), log(1.1)], [0.60, 0.50, 0.45])
    assert s.vol(70_000) == pytest.approx(0.50)
    mid = 70_000 * sqrt(1.0 * 1.1)  # halfway in log-moneyness between 1.0 and 1.1
    assert s.vol(mid) == pytest.approx(0.475)
    assert s.vol(40_000) == 0.60 and s.vol(200_000) == 0.45


def summaries():
    rows = []
    for expiry_tag, fwd, atm in (("14NOV26", 70_100, 0.50), ("15NOV26", 70_200, 0.40)):
        for k, skew in ((63_000, 0.10), (70_000, 0.0), (77_000, -0.04)):
            for kind in "CP":
                rows.append(
                    {
                        "instrument_name": f"BTC-{expiry_tag}-{k}-{kind}",
                        "mark_iv": 100 * (atm + skew),
                        "underlying_price": fwd,
                    }
                )
    rows.append({"instrument_name": "BTC-13NOV26-70000-C", "mark_iv": 40, "underlying_price": 7e4})
    return rows


def test_surface_before_first_expiry_uses_its_smile():
    surf = Surface.from_deribit(summaries(), NOW)
    assert [s.expiry for s in surf.smiles] == [D1, D2]  # the expired 13NOV26 08:00 is dropped
    close = NOW + 4 * 3600
    for k in (63_000, 70_100, 75_000):  # any strike: exactly the first expiry's smile
        assert surf.vol(k, close, NOW) == surf.smiles[0].vol(k)
    assert surf.vol(70_100, close, NOW) == pytest.approx(0.4994, abs=1e-4)  # near ATM ≈ 0.50


def test_surface_between_expiries_interpolates_total_variance():
    surf = Surface.from_deribit(summaries(), NOW)
    close = NOW + 32 * 3600  # halfway between 20 h and 44 h
    k = 72_000
    k0 = 72_000 * 70_100 / 70_200  # same log-moneyness on D1's forward
    w0 = surf.smiles[0].vol(k0) ** 2 * 20  # total variance, in hours
    w1 = surf.smiles[1].vol(k) ** 2 * 44
    want = sqrt((w0 + (w1 - w0) * 12 / 24) / 32)  # linear in time, back to a volatility
    assert surf.vol(k, close, NOW) == pytest.approx(want, rel=1e-3)


def test_slope_is_negative_with_downside_skew():
    surf = Surface.from_deribit(summaries(), NOW)
    assert surf.vol_slope(72_000, NOW + 4 * 3600, NOW) < 0
