"""Store the screener's contracts and the cross-venue pairs (steps 2 and 4, docs/product.md).

On the VM, manta-contracts.service runs `contracts -out FILE` (recorder/cmd/contracts) and then
`manta-contracts FILE`, every minute. The file replaces every row of manta.markets and
manta.pairs in one transaction, so the site always reads one complete listing.
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


def pair_row(p: dict, updated: str) -> list:
    k, q = p["kalshi"], p["polymarket"]
    side = [k["ids"], k["bid"], k["ask"], k["bid_size"], k["ask_size"]]
    side += [q["ids"], q["bid"], q["ask"], q["bid_size"], q["ask_size"]]
    return [p["topic"], p["question"], p["kind"], p["note"], p["close"], p["order"], *side, updated]


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
        conn.execute("delete from manta.pairs")
        conn.cursor().executemany(
            "insert into manta.pairs values"
            " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [pair_row(p, listing["generated"]) for p in listing.get("pairs", [])],
        )
    print(
        f"stored {len(rows)} contracts, {len(listing.get('pairs', []))} pairs"
        f" of {listing['generated']}",
        end="",
    )
    print(f"; left out: {'; '.join(listing['errors'])}" if listing["errors"] else "")


if __name__ == "__main__":
    main()
