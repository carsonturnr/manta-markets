from manta_pricing.quality import notify, problems


def report(last: str, coverage: float) -> dict:
    return {
        "generated": "2026-11-26T16:02:00Z",
        "venues": [
            {"venue": "kalshi", "last": "2026-11-26T16:01:59.325665566Z", "coverage": 0.997},
            {"venue": "deribit", "last": last, "coverage": coverage},
        ],
    }


def test_problems():
    assert problems(report("2026-11-26T16:01:00Z", 0.995)) == []
    assert problems(report("2026-11-26T15:30:00Z", 0.985)) == [
        "deribit: no data for 32 minutes",
        "deribit: coverage 98.50%, under 99%",
    ]


def test_notify_only_on_change(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("OPS_EMAIL", raising=False)
    state = tmp_path / "quality-alert.txt"
    notify(report("2026-11-26T16:01:00Z", 0.995), state)  # healthy, no state: nothing changed
    assert not state.exists()
    notify(report("2026-11-26T15:30:00Z", 0.995), state)
    assert "changed (1 now)" in capsys.readouterr().out
    notify(report("2026-11-26T15:30:00Z", 0.995), state)  # same problem: silent
    assert capsys.readouterr().out == ""
