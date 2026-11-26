"""Store the recorder's data-quality report for the site's /quality page (step 1, docs/product.md).

On the VM, manta-quality.service runs `status -json FILE` (recorder/cmd/status) and then
`manta-quality FILE`, every 15 minutes. The report replaces the single row of manta.quality.

It also emails the operator (OPS_EMAIL in /etc/manta/env, through Resend like alerts.py) when a
venue stops recording or its coverage drops below 99%, and again when that clears. It emails
only when the list of problems changes, which it remembers in a file next to the report. It
runs on the same VM, so a VM that is down entirely sends nothing.
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from psycopg.types.json import Jsonb

from manta_pricing.alerts import http
from manta_pricing.snapshot import connect

STALE_SECONDS = 600  # status runs every 15 minutes; a venue silent for 10 is down, not quiet
MIN_COVERAGE = 0.99


def problems(report: dict) -> list[str]:
    """One line per venue that is stale or under MIN_COVERAGE, in report order."""
    now = datetime.fromisoformat(report["generated"])
    out = []
    for v in report["venues"]:
        age = (now - datetime.fromisoformat(v["last"])).total_seconds()
        if age > STALE_SECONDS:
            out.append(f"{v['venue']}: no data for {age / 60:.0f} minutes")
        if v["coverage"] < MIN_COVERAGE:
            out.append(f"{v['venue']}: coverage {v['coverage']:.2%}, under {MIN_COVERAGE:.0%}")
    return out


def notify(report: dict, state: Path) -> None:
    """Emails OPS_EMAIL when the problem list differs from the last run's."""
    now = problems(report)
    before = state.read_text().splitlines() if state.exists() else []
    if now == before:
        return
    to = os.environ.get("OPS_EMAIL")
    if not to:
        print(f"recorder problems changed ({len(now)} now); OPS_EMAIL unset, not emailed")
    else:
        subject = "Manta recorder: " + ("problem" if now else "all clear")
        text = "\n".join(now) if now else "Every venue is recording, coverage at least 99%."
        text += f"\n\nReport of {report['generated']}. https://mantamarkets.com/how-its-built"
        http("https://api.resend.com/emails", os.environ["RESEND_API_KEY"], {
            "from": "Manta recorder <alerts@mantamarkets.com>", "to": [to],
            "subject": subject, "text": text,
        })  # fmt: skip
        print(f"emailed: {subject}")
    state.write_text("\n".join(now))  # written after the email, so a failed send retries


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("report", type=Path, help="the JSON written by status -json")
    a = ap.parse_args()
    report = json.loads(a.report.read_text())
    with connect() as conn:
        conn.execute(
            "insert into manta.quality (id, updated, report) values (true, %s, %s)"
            " on conflict (id) do update"
            " set updated = excluded.updated, report = excluded.report",
            (report["generated"], Jsonb(report)),
        )
    print(
        f"stored report of {report['generated']}: {len(report['venues'])} venues, "
        f"{len(report['families'])} families"
    )
    notify(report, a.report.with_name("quality-alert.txt"))


if __name__ == "__main__":
    main()
