"""Hand-worked cases for the backtest's arithmetic (manta_backtest.mm)."""

import pytest

from manta_backtest.catalog import deltas, instrument, trade
from manta_backtest.mm import Fill, kalshi_fee, split, trades_first

S = 1_000_000_000
M = {
    "ticker": "KXTEST-26NOV2317-T1",
    "price_ranges": [{"step": "0.01"}],
    "open_time": "2026-11-23T00:00:00Z",
    "latest_expiration_time": "2026-11-24T00:00:00Z",
    "title": "test",
}
INST = instrument(M, 0)


def book(t, kind, bids, asks=()):
    msg = {
        "recv_ts": t,
        "venue_ts_ms": None,
        "venue_seq": 1,
        "kind": kind,
        "bids": bids,
        "asks": list(asks),
    }
    return deltas(msg, INST)


def sell(t, sz, i=1):
    msg = {
        "recv_ts": t,
        "venue_ts_ms": None,
        "px": "0.40",
        "sz": sz,
        "side": "sell",
        "trade_id": f"t{i}",
        "market_id": M["ticker"],
        "rseq": i,
    }
    return trade(msg, INST)


def test_kalshi_fee():
    assert kalshi_fee(0.5, 100, 0.07) == pytest.approx(1.75)  # 0.07 x 100 x 0.25
    assert kalshi_fee(0.33, 1, 0.07) == pytest.approx(0.0155)  # 0.015477, rounded up
    assert kalshi_fee(0.40, 10, 0.0) == 0.0  # KXBTCD makers


def test_trade_moves_before_its_size_drop():
    d = book(1 * S, "snapshot", [["0.40", "100"]], [["0.42", "100"]])
    d += book(2 * S, "delta", [["0.40", "40"]])  # the trade's size drop arrives first
    (t,) = trades_first(d, [sell(2 * S + 5_000_000, "60")])
    assert t.ts_init == 2 * S - 1


def test_trade_that_came_first_is_left_alone():
    d = book(1 * S, "snapshot", [["0.40", "100"]], [["0.42", "100"]])
    d += book(3 * S, "delta", [["0.40", "40"]])
    (t,) = trades_first(d, [sell(2 * S, "60")])
    assert t.ts_init == 2 * S


def test_old_drop_and_snapshot_do_not_match():
    d = book(1 * S, "snapshot", [["0.40", "100"]], [["0.42", "100"]])
    d += book(2 * S, "delta", [["0.40", "40"]])
    d += book(5 * S, "snapshot", [["0.40", "10"]], [["0.42", "100"]])  # resubscribe, not a trade
    trades = [sell(4 * S, "60", 1), sell(5 * S + 1, "10", 2)]
    assert [t.ts_init for t in trades_first(d, trades)] == [4 * S, 5 * S + 1]


def test_split_adds_up():
    fills = [
        Fill("A", 0, +1, 0.40, 10, 0.0, mid_before=0.41, mid_after=0.39, settle=0.0),
        Fill("A", 1, -1, 0.42, 4, 0.01, mid_before=0.41, mid_after=0.40, settle=0.0),
    ]
    out = split(fills)
    # Bought 10 at 0.40 (spread +0.10, adverse -0.20, inventory -3.90);
    # sold 4 at 0.42 (spread +0.04, adverse +0.04, inventory +1.60), fee 0.01.
    assert out["spread"] == pytest.approx(0.14)
    assert out["adverse"] == pytest.approx(-0.16)
    assert out["inventory"] == pytest.approx(-2.30)
    assert out["fees"] == pytest.approx(-0.01)
    assert out["total"] == pytest.approx(-4.00 + 1.68 - 0.01)
    parts = out["spread"] + out["adverse"] + out["inventory"] + out["fees"]
    assert parts == pytest.approx(out["total"])
