from manta_pricing.accuracy import due, kalshi_result, polymarket_result
from manta_pricing.fairvalues import ts

CLOSE = "2026-11-17T22:00:00Z"


def contract(**kw) -> dict:
    c = {"venue": "kalshi", "id": "KXBTCD-26NOV1717-T64999.99", "family": "KXBTCD",
         "event": "KXBTCD-26NOV1717", "close": CLOSE, "bid": 0.40, "ask": 0.42}  # fmt: skip
    return {**c, **kw}


def at(minutes_before: float, iso: str = CLOSE) -> float:
    return ts(iso) - minutes_before * 60


def test_a_prediction_is_taken_once_inside_each_horizon():
    fairs = {("kalshi", "KXBTCD-26NOV1717-T64999.99"): (0.45, "options")}
    # The minute job runs at :30, so a contract closing on the hour is 4.5 minutes away.
    [row] = due([contract()], [], fairs, at(4.5))
    assert row[4] == 5 and row[7:] == (0.40, 0.42, 0.45, "options")
    assert due([contract()], [], fairs, at(59.5))[0][4] == 60
    # Within a tenth of the horizon: 54 to 60 minutes counts as an hour, 50 doesn't.
    assert due([contract()], [], fairs, at(54.5))[0][4] == 60
    assert due([contract()], [], fairs, at(50)) == []
    assert due([contract()], [], fairs, at(1439.5))[0][4] == 1440
    assert due([contract()], [], fairs, at(10079.5))[0][4] == 10080


def test_no_prediction_without_both_sides_or_after_the_close():
    assert due([contract(bid=None)], [], {}, at(4.5)) == []
    assert due([contract(ask=None)], [], {}, at(4.5)) == []
    assert due([contract()], [], {}, at(-0.5)) == []
    # No fair value: the venue's prediction is still kept.
    assert due([contract()], [], {}, at(4.5))[0][9:] == (None, None)


def test_polymarket_economics_is_timed_by_its_kalshi_pair():
    # Polymarket's CPI market closes the next day; the release is at Kalshi's close.
    cpi = contract(venue="polymarket", id="0xabc", family="cpi", event="november-inflation-us",
                   close="2026-12-11T04:59:00Z")  # fmt: skip
    pair = {"close": "2026-12-10T13:29:00Z", "polymarket": {"ids": ["0xabc"]}}
    [row] = due([cpi], [pair], {}, at(4.5, "2026-12-10T13:29:00Z"))
    assert row[4] == 5 and row[6].isoformat() == "2026-12-10T13:29:00+00:00"
    assert due([cpi], [pair], {}, at(4.5, "2026-12-11T04:59:00Z")) == []
    # Unpaired: left out, its close isn't when it's decided.
    assert due([cpi], [], {}, at(4.5, "2026-12-11T04:59:00Z")) == []
    # Polymarket's crypto markets close when they settle: their own close counts.
    btc = contract(venue="polymarket", id="0xdef", family="btc-above")
    assert due([btc], [], {}, at(4.5))[0][4] == 5


def test_results():
    assert kalshi_result({"result": "yes"}) == 1
    assert kalshi_result({"result": "no"}) == 0
    assert kalshi_result({"result": ""}) is None
    m = {"closed": True, "umaResolutionStatus": "resolved", "outcomes": '["Yes", "No"]'}
    assert polymarket_result({**m, "outcomePrices": '["1", "0"]'}) == 1
    assert polymarket_result({**m, "outcomePrices": '["0", "1"]'}) == 0
    assert polymarket_result({**m, "outcomePrices": '["0.5", "0.5"]'}) is None
    assert (
        polymarket_result({**m, "umaResolutionStatus": "proposed", "outcomePrices": '["1", "0"]'})
        is None
    )
    assert polymarket_result({**m, "closed": False, "outcomePrices": '["1", "0"]'}) is None
