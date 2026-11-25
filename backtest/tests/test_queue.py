"""Hand-worked cases for the queue model (manta_backtest.queue)."""

import math
from datetime import datetime

import pytest

from manta_backtest.queue import (
    MATCH_NS,
    Measure,
    Resting,
    active,
    bucket,
    day_type,
    mean_se,
    merge,
    outcome,
    stretches,
)

S = 1_000_000_000  # one second in ns


def test_trade_uses_queue_ahead_then_fills():
    o = Resting(0, 500)  # 500 ahead of us
    o.trade(1 * S, 300)
    o.level(1 * S, 200)  # the trade's size drop: no cancellation
    assert o.ahead == dict.fromkeys(o.ahead, 200)
    o.trade(2 * S, 250)
    o.level(2 * S, 0)
    assert o.past["behind"] == 50  # 200 used the queue, 50 reached us
    assert o.fill_at[("behind", 1)] == 2 * S
    assert ("behind", 100) not in o.fill_at


def test_arrival_order_does_not_matter():
    # Kalshi's size drop may arrive before or after its trade: same result, no double count.
    a, b = Resting(0, 500), Resting(0, 500)
    a.trade(S, 100)
    a.level(S, 400)
    b.level(S, 400)
    b.trade(S, 100)
    for o in (a, b):
        o.expire(10 * S)
        assert o.ahead == dict.fromkeys(o.ahead, 400)
        assert o.past == dict.fromkeys(o.past, 0)


def test_cancellations_three_ways():
    o = Resting(0, 100)  # 100 ahead
    o.level(S, 400)  # 300 join behind us
    o.level(2 * S, 200)  # 200 cancel, no trade explains it
    o.expire(2 * S + MATCH_NS + 1)
    assert o.ahead == {"behind": 100, "proportional": 50, "ahead": 0}
    assert o.behind == {"behind": 100, "proportional": 150, "ahead": 200}


def test_queue_ahead_never_exceeds_the_book():
    o = Resting(0, 300)  # nobody behind us: any cancellation is ahead, in every model
    o.level(S, 100)
    o.expire(S + MATCH_NS + 1)
    assert o.ahead == dict.fromkeys(o.ahead, 100)


def test_trade_through_fills():
    o = Resting(0, 1000)
    o.trade(S, 150, through=True)  # a seller went below our bid
    assert o.fill_at[("behind", 100)] == S


def test_outcome_censors_short_lives():
    o = Resting(0, 0)
    o.trade(5 * S, 1)
    out = outcome(o, end=30 * S)  # market closed after 30 s
    assert out[(10, "behind", 1)] is True
    assert out[(10, "behind", 100)] is False
    assert out[(60, "behind", 100)] is None  # never saw a full minute


def test_measure_end_to_end():
    m = Measure(sample_s=1, place_s=1000)
    book = {
        "market_id": "X",
        "kind": "snapshot",
        "bids": [["0.40", "50"]],
        "asks": [["0.42", "70"]],
    }
    m.handle({"type": "book", "msg": {"recv_ts": S, **book}})  # mid 0.41; orders 50 and 70 behind
    trade = {"market_id": "X", "recv_ts": 2 * S, "side": "sell", "px": "0.40", "sz": "60"}
    m.handle({"type": "trade", "msg": trade})  # a taker sells 60 into the bid: 10 reach us
    delta = {**book, "kind": "delta", "recv_ts": 3 * S, "bids": [["0.40", "0"], ["0.39", "100"]]}
    m.handle({"type": "book", "msg": delta})  # the bid falls: mid 0.405
    m.handle({"type": "book", "msg": {**delta, "recv_ts": 100 * S, "bids": [], "asks": []}})
    closed = {**book, "bids": [], "asks": [], "recv_ts": 101 * S}
    m.handle({"type": "book", "msg": closed})  # the close
    m.handle({"type": "book", "msg": {**book, "market_id": "Y", "recv_ts": 400 * S}})

    fills = m.agg["fills"]
    assert fills["off-hours|0-100|10|behind|1"] == [1, 2]  # the bid filled, the ask did not
    assert fills["off-hours|0-100|10|behind|100"] == [0, 2]
    assert "off-hours|0-100|300|behind|1" in fills  # lived 100 s: 300 s still counted (filled)

    marks = m.agg["marks"]
    for kind in ("trades", "fills-behind", "fills-ahead"):
        w = 60 if kind == "trades" else 1
        n, sw, _, swx, _, sws = marks[f"{kind}|off-hours|10"]
        assert n == 1 and sw == w
        assert swx / sw == pytest.approx(0.005)  # bought at 0.40, mid 0.405 ten seconds later
        assert sws / sw == pytest.approx(0.01)  # spread earned: mid 0.41 at the trade
    assert marks["trades|off-hours|300"][3] / 60 == pytest.approx(0.005)  # at the close's mid
    assert m.agg["at_close"]["trades|300"] == 1


def test_markout_sell_side_and_mean():
    m = Measure(sample_s=1000, place_s=1000)
    m.books["X"] = {"bids": {0.40: 10}, "asks": {0.42: 10}}
    m.mark(0, "X", "trades", -1, 0.42, 2.0, 0.41)  # a maker sold 2 at 0.42, mid 0.41
    m.books["X"] = {"bids": {0.43: 10}, "asks": {0.45: 10}}  # the price rose to mid 0.44
    m.resolve(10 * S)
    acc = m.agg["marks"]["trades|off-hours|10"]
    mean, se, spread = mean_se(acc)
    assert spread == pytest.approx(0.01)
    assert mean == pytest.approx(-0.02)  # sold at 0.42, now worth 0.44
    assert math.isnan(se)  # one trade: no error estimate


def test_day_types():
    t = lambda iso: int(datetime.fromisoformat(iso + "+00:00").timestamp() * 1e9)  # noqa: E731
    vol = [(t("2026-11-19T13:00"), t("2026-11-19T18:00"))]
    assert day_type(t("2026-11-23T15:00"), vol) == "us-hours"  # Monday 10:00 New York
    assert day_type(t("2026-11-23T21:00"), vol) == "off-hours"  # 16:00, the close
    assert day_type(t("2026-11-22T15:00"), vol) == "weekend"
    assert day_type(t("2026-11-19T14:00"), vol) == "volatile"


def test_merge_joins_samples_and_adds_totals():
    part = {
        "hours": 2,
        "trades": {"KXBTCD": [1, 2.0, 3.0]},
        "series": {
            "KXBTCD": {
                "queue": {"weekend": [5, 6]},
                "one_cent": {"weekend": [1, 2]},
                "fills": {"k": [1, 3]},
                "marks": {"k": [1, 1, 1, 0.5, 0.25, 0.1]},
                "censored": {"k": 1},
                "at_close": {},
                "unmatched": 4.0,
            }
        },
    }
    out = merge([part, part])
    agg = out["series"]["KXBTCD"]
    assert out["hours"] == 4 and out["trades"]["KXBTCD"] == [2, 4.0, 6.0]
    assert agg["queue"]["weekend"] == [5, 6, 5, 6]
    assert agg["one_cent"]["weekend"] == [2, 4] and agg["fills"]["k"] == [2, 6]
    assert agg["censored"]["k"] == 2 and agg["unmatched"] == 8.0


def test_active_and_bucket():
    assert active({"bids": {0.01: 5}, "asks": {0.02: 5}}) is None  # pinned far strike
    assert active({"bids": {0.40: 5, 0.39: 9}, "asks": {0.42: 7}}) == (0.40, 5, 0.42, 7)
    assert bucket(99) == "0-100"
    assert bucket(1_000) == "1,000-10,000"
    assert bucket(50_000) == "10,000+"


def test_stretches_split_on_missing_hours():
    files = [
        "k/2026-11-23/13-0000.jsonl.gz",
        "k/2026-11-23/14-0000.jsonl.gz",
        "k/2026-11-23/19-0000.jsonl.gz",
        "k/2026-11-23/23-0000.jsonl.gz",
        "k/2026-11-24/00-0000.jsonl.gz",
        "k/2026-11-23/22-3519.jsonl.gz",
        "k/2026-11-30/23-0000.jsonl.gz",
        "k/2026-12-01/00-0000.jsonl.gz",
    ]
    assert stretches(files) == [
        ["k/2026-11-23/13-0000.jsonl.gz", "k/2026-11-23/14-0000.jsonl.gz"],
        ["k/2026-11-23/19-0000.jsonl.gz"],
        [
            "k/2026-11-23/22-3519.jsonl.gz",
            "k/2026-11-23/23-0000.jsonl.gz",
            "k/2026-11-24/00-0000.jsonl.gz",
        ],
        ["k/2026-11-30/23-0000.jsonl.gz", "k/2026-12-01/00-0000.jsonl.gz"],
    ]


def test_spread_uses_the_mid_before_the_trades_own_book_change():
    m = Measure(sample_s=1, place_s=1000)
    book = {
        "market_id": "X",
        "kind": "snapshot",
        "bids": [["0.40", "50"]],
        "asks": [["0.42", "70"]],
    }
    m.handle({"type": "book", "msg": {"recv_ts": S, **book}})  # watched from here: mid 0.41
    delta = {**book, "kind": "delta", "recv_ts": 5 * S, "bids": [["0.40", "0"], ["0.39", "9"]]}
    m.handle({"type": "book", "msg": delta})  # the bid is eaten; its trade arrives just after
    trade = {"market_id": "X", "recv_ts": 5 * S + 1000, "side": "sell", "px": "0.40", "sz": "50"}
    m.handle({"type": "trade", "msg": trade})
    m.resolve(16 * S)
    n, w, _, wx, _, ws = m.agg["marks"]["trades|off-hours|10"]
    assert ws / w == pytest.approx(0.01)  # against 0.41, not the 0.405 after the change
    assert wx / w == pytest.approx(0.005)
