"""Hand-worked cases for the queue model (manta_backtest.queue)."""

from manta_backtest.queue import (
    HORIZONS_S,
    MATCH_NS,
    Measure,
    Resting,
    active,
    bucket,
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
    m = Measure(sample_s=1, place_s=10)
    book = {
        "market_id": "X",
        "kind": "snapshot",
        "bids": [["0.40", "50"]],
        "asks": [["0.42", "70"]],
    }
    m.handle({"type": "book", "msg": {"recv_ts": S, **book}})
    assert len(m.orders["X"]) == 2  # one at the bid, one at the ask, 50 and 70 ahead
    trade = {"market_id": "X", "recv_ts": 2 * S, "side": "sell", "px": "0.40", "sz": "60"}
    m.handle({"type": "trade", "msg": trade})  # a taker sells 60 into the bid
    closed = {**book, "bids": [], "asks": [], "recv_ts": 4 * S}
    m.handle({"type": "book", "msg": closed})  # the close, 3 s after placing
    bid = next(r["out"] for r in m.results if r["side"] == "bids")
    ask = next(r["out"] for r in m.results if r["side"] == "asks")
    assert bid[(10, "behind", 1)] is True  # 10 of the 60 reached us
    assert bid[(10, "behind", 100)] is None  # not filled in full, and lived only 3 s
    assert ask[(HORIZONS_S[0], "ahead", 1)] is None


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
