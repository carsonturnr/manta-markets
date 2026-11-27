"""Hand-worked cases for the market maker's caps (manta_backtest.strategy), no engine needed."""

from manta_backtest.strategy import MarketMaker, event_of

A, B = "KXBTCD-26NOV2317-T62499.99", "KXBTCD-26NOV2317-T62749.99"


def mm():
    return MarketMaker(0.25, 0, {}, {})


def test_event_of():
    assert event_of(A) == "KXBTCD-26NOV2317"


def test_per_contract_cap():
    m = mm()
    m.pos[A] = 15.0
    assert m.exposure_ok(A, 1)  # 15 + 5 = 20, at the cap
    m.pos[A] = 16.0
    assert not m.exposure_ok(A, 1)  # 21
    assert m.exposure_ok(A, -1)  # selling reduces it


def test_event_cap_counts_resting_orders():
    m = mm()
    m.pos[A] = 20.0
    m.pos[B] = 20.0
    m.live[(B, 1)] = {"id": 1}  # B could reach 25 if its resting buy filled
    assert m.exposure_ok(A, -1)  # selling A shrinks it: event stays 20 + 25 = 45
    m.pos[A] = 10.0
    assert m.exposure_ok(A, 1)  # A 15: 15 + 25 = 40
    m.live[(A, 1)] = {"id": 2}
    assert m.exposure_ok(A, -1)  # worst A max(15, 5) = 15: 40
    m.pos[B] = -20.0  # B now short 20 (worst 20 either way with its buy resting)
    m.pos[A] = 25.0  # hypothetical: A 25 (+5 resting) = 30, event 50 (at the cap)
    assert not m.exposure_ok("KXBTCD-26NOV2317-T63000", 1)  # a third contract: 55 > 50


def test_total_cap():
    m = mm()
    for i in range(10):  # ten events, 19 contracts each: 190 in all
        m.pos[f"KXBTCD-26NOV23{i:02d}-T1"] = 19.0
    assert m.exposure_ok("KXBTCD-26NOV2399-T1", 1)  # 190 + 5 = 195
    m.pos["KXBTCD-26NOV2398-T1"] = 6.0  # 196 + 5 = 201
    assert not m.exposure_ok("KXBTCD-26NOV2399-T1", 1)
    assert m.exposure_ok("KXBTCD-26NOV2398-T1", -1)  # unwinding is always allowed
