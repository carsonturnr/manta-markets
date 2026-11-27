"""Hand-worked cases for measurement 3 (manta_backtest.predict)."""

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from manta_backtest.predict import add, measure_day, ols, ttc_bucket


def test_ols_recovers_a_line():
    acc: dict = {}
    for g in (-0.03, -0.01, 0.0, 0.02, 0.04):
        add(acc, "k", g, 0.5 * g)  # half of every gap closes
    slope, se, r2 = ols(acc["k"])
    assert slope == pytest.approx(0.5)
    assert se == pytest.approx(0.0, abs=1e-9)
    assert r2 == pytest.approx(1.0)


def test_hit_rate_needs_a_1c_gap_and_a_move():
    acc: dict = {}
    add(acc, "k", 0.02, 0.01)  # right direction
    add(acc, "k", -0.02, 0.01)  # wrong
    add(acc, "k", 0.005, 0.01)  # gap under 1c: not counted
    add(acc, "k", 0.03, 0.0)  # no move: not counted
    assert acc["k"][6:] == [1, 2]


def test_ttc_buckets():
    assert ttc_bucket(299) == "under 5 min"
    assert ttc_bucket(300) == "5-15 min"
    assert ttc_bucket(3599) == "15-60 min"
    assert ttc_bucket(3600) == "over 1 h"


def test_measure_day(tmp_path):
    # Thursday 1970-01-01 is a weekday; 00:00 UTC is off-hours.
    mids = {"ticker": ["A"] * 4, "sec": [100, 110, 160, 450], "mid": [0.40, 0.41, 0.42, 0.5]}
    pq.write_table(pa.table(mids), tmp_path / "mids.parquet")
    fair = {
        "ticker": ["A", "A", "B"],
        "ts": [100 * 10**9, 105 * 10**9, 100 * 10**9],
        "fair": [0.44, 0.5, 0.5],
        "index": [0.0] * 3,
    }
    pq.write_table(pa.table(fair), tmp_path / "fair.parquet")
    acc: dict = {}
    censored: dict = {}
    measure_day(tmp_path, {"A": 100 + 1200}, [], acc, censored)
    # Only A at 100 s has a mid: gap 0.04; 10 s later +0.01, 60 s +0.02, 300 s: no mid.
    assert acc["off-hours|15-60 min|10"][:3] == [1, pytest.approx(0.04), pytest.approx(0.01)]
    assert acc["off-hours|15-60 min|60"][2] == pytest.approx(0.02)
    assert censored == {"300": 1}
