"""Store the screener's contracts and the cross-venue pairs (steps 2 and 4, docs/product.md).

On the VM, manta-contracts.service runs `contracts -out FILE` (recorder/cmd/contracts) and then
`manta-contracts FILE`, every minute. The file replaces every row of manta.markets and
manta.pairs in one transaction, so the site always reads one complete listing.
"""

import argparse
import json
import time
from pathlib import Path

from manta_pricing.fairvalues import fair_values, fetch_crypto
from manta_pricing.snapshot import connect

COLUMNS = [
    "venue", "id", "family", "event", "title", "label", "payoff", "low", "high", "inclusive",
    "close_time", "bid", "ask", "bid_size", "ask_size", "last", "volume_24h", "volume_unit",
    "open_interest", "updated", "fair", "fair_method", "fee_taker", "fee_maker",
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
    now = time.time()
    crypto, errors = fetch_crypto(now)
    fairs = fair_values(listing["contracts"], listing.get("pairs", []), crypto, now)
    rows = []
    for c in listing["contracts"]:
        fair, method = fairs.get((c["venue"], c["id"]), (None, None))
        rows.append(
            {**c, "close_time": c["close"], "updated": listing["generated"], "fair": fair,
             "fair_method": method}
        )  # fmt: skip
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
        f"stored {len(rows)} contracts ({len(fairs)} with a fair value),"
        f" {len(listing.get('pairs', []))} pairs of {listing['generated']}",
        end="",
    )
    for e in errors:
        print(f"; {e}", end="")
    print(f"; left out: {'; '.join(listing['errors'])}" if listing["errors"] else "")


if __name__ == "__main__":
    main()
