from collections import namedtuple

from manta_pricing.quality import disk, notify, problems

Usage = namedtuple("Usage", "total used free")


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


def test_disk():
    assert disk(Usage(100, 80, 20)) == []  # exactly 80%: not over
    assert disk(Usage(100, 81, 19)) == ["disk: over 80% full"]


def test_notify_extra_problems(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("OPS_EMAIL", raising=False)
    state = tmp_path / "quality-alert.txt"
    db = ["database: down (the report could not be stored)"]
    notify(report("2026-11-26T16:01:00Z", 0.995), state, db)  # healthy venues, database down
    assert "changed (1 now)" in capsys.readouterr().out
    assert state.read_text() == db[0]
    notify(report("2026-11-26T16:01:00Z", 0.995), state)  # database back: all clear
    assert "changed (0 now)" in capsys.readouterr().out


def test_main_emails_when_database_down(tmp_path, monkeypatch, capsys):
    import json
    import sys

    import psycopg
    import pytest

    from manta_pricing import quality

    def down():
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(quality, "connect", down)
    monkeypatch.delenv("OPS_EMAIL", raising=False)
    path = tmp_path / "quality.json"
    path.write_text(json.dumps(report("2026-11-26T16:01:00Z", 0.995)))
    monkeypatch.setattr(sys, "argv", ["manta-quality", str(path)])
    with pytest.raises(SystemExit):
        quality.main()
    assert "report not stored" in capsys.readouterr().out
    lines = (tmp_path / "quality-alert.txt").read_text().splitlines()
    assert lines[0] == "database: down (the report could not be stored)"
