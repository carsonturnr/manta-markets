"""Store the recorder's data-quality report for the site's /quality page (step 1, docs/product.md).

On the VM, manta-quality.service runs `status -json FILE` (recorder/cmd/status) and then
`manta-quality FILE`, every 15 minutes. The report replaces the single row of manta.quality.
"""

import argparse
import json
from pathlib import Path

from psycopg.types.json import Jsonb

from manta_pricing.snapshot import connect


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


if __name__ == "__main__":
    main()
