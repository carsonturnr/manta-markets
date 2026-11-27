"""The paper bot's safety checks (manta_backtest.paper), no connection made."""

import pytest
from nautilus_trader.adapters.kalshi import KalshiEnvironment

from manta_backtest.paper import demo_credentials, require_demo


def test_refuses_anything_but_demo():
    require_demo(KalshiEnvironment.DEMO)
    with pytest.raises(SystemExit, match="not DEMO"):
        require_demo(KalshiEnvironment.PRODUCTION)
    with pytest.raises(SystemExit):
        require_demo("DEMO")  # a string is not the adapter's DEMO value


def test_real_account_keys_are_removed(tmp_path):
    pem = tmp_path / "demo.pem"
    pem.write_text("demo key")
    env = {
        "KALSHI_API_KEY_ID": "real",
        "KALSHI_PRIVATE_KEY_PATH": "/real.pem",
        "KALSHI_DEMO_API_KEY_ID": "demo-id",
        "KALSHI_DEMO_PRIVATE_KEY_PATH": str(pem),
    }
    assert demo_credentials(env) == ("demo-id", "demo key")
    assert "KALSHI_API_KEY_ID" not in env and "KALSHI_PRIVATE_KEY_PATH" not in env


def test_missing_demo_keys_stop_the_bot():
    env = {"KALSHI_API_KEY_ID": "real", "KALSHI_PRIVATE_KEY_PATH": "/real.pem"}
    with pytest.raises(SystemExit, match="KALSHI_DEMO_API_KEY_ID"):
        demo_credentials(env)
    assert env == {}  # the real keys are gone even when it stops


def test_summary_from_logs(tmp_path, monkeypatch, capsys):
    import json
    import sys

    from manta_backtest.paper import summary_main

    tk = "KXBTCD-26NOV2317-T1"
    lines = [
        {"time": "2026-11-27T10:00:00+00:00", "kind": "start"},
        {"time": "2026-11-27T10:00:01+00:00", "kind": "OrderSubmitted"},
        {"time": "2026-11-27T10:00:02+00:00", "kind": "OrderDenied"},
        {
            "time": "2026-11-27T10:00:05+00:00",
            "kind": "fill",
            "ticker": tk,
            "ts": 5,
            "side": 1,
            "price": 0.40,
            "qty": 1.0,
            "mid_before": 0.41,
            "mid_after": None,
        },
        {
            "time": "2026-11-27T10:01:05+00:00",
            "kind": "markout",
            "ticker": tk,
            "ts": 5,
            "mid_after": 0.39,
        },
        {"time": "2026-11-27T11:00:00+00:00", "kind": "stop"},
    ]
    (tmp_path / "2026-11-27.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    (tmp_path / "settle.json").write_text(json.dumps({tk: 0.0}))  # settled NO: no fetch needed
    monkeypatch.setattr(sys, "argv", ["manta-paper-summary", "--log-dir", str(tmp_path)])
    summary_main()
    out = json.loads(capsys.readouterr().out)
    # Bought 1 at 0.40: spread +0.01 (mid 0.41), adverse -0.02 (mid 0.39), settled 0: -0.39.
    assert out["pnl"] == {
        "spread": 0.01,
        "adverse": -0.02,
        "inventory": -0.39,
        "fees": 0.0,
        "total": -0.4,
    }
    assert out["refused_rate_limit"] == 1 and out["fills"] == 1 and out["uptime_hours"] == 1.0
