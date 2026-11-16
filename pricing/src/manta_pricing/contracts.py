"""Store the screener's contracts (step 2, docs/product.md).

On the VM, manta-contracts.service runs `contracts -out FILE` (recorder/cmd/contracts) and then
`manta-contracts FILE`, every minute. The file replaces every row of manta.markets in one
transaction, so the site always reads one complete listing.
"""

import argparse
import json
from pathlib import Path

from manta_pricing.snapshot import connect

COLUMNS = [
    "venue", "id", "family", "event", "title", "label", "payoff", "low", "high", "inclusive",
    "close_time", "bid", "ask", "bid_size", "ask_size", "last", "volume_24h", "volume_unit",
    "open_interest", "updated",
]  # fmt: skip


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("listing", type=Path, help="the JSON written by contracts -out")
    a = ap.parse_args()
    listing = json.loads(a.listing.read_text())
    rows = [
        {**c, "close_time": c["close"], "updated": listing["generated"]}
        for c in listing["contracts"]
    ]
    with connect() as conn, conn.transaction():
        conn.execute("delete from manta.markets")
        with conn.cursor().copy(f"copy manta.markets ({', '.join(COLUMNS)}) from stdin") as copy:
            for r in rows:
                copy.write_row([r[c] for c in COLUMNS])
    print(f"stored {len(rows)} contracts of {listing['generated']}", end="")
    print(f"; left out: {'; '.join(listing['errors'])}" if listing["errors"] else "")


if __name__ == "__main__":
    main()
