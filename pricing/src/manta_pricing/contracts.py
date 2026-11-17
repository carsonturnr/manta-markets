"""Store the screener's contracts, the cross-venue pairs and the implied distributions (steps 2,
4 and 7, docs/product.md).

On the VM, manta-contracts.service runs `contracts -out FILE` (recorder/cmd/contracts) and then
`manta-contracts FILE`, every minute. The file replaces every row of manta.markets and
manta.pairs in one transaction, so the site always reads one complete listing.
"""

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from psycopg.types.json import Jsonb

from manta_pricing.distribution import Distribution, distributions
from manta_pricing.fairvalues import fair_values, fetch_crypto
from manta_pricing.liquidity import EVERY_MIN, samples
from manta_pricing.snapshot import connect

COLUMNS = [
    "venue", "id", "family", "event", "title", "label", "payoff", "low", "high", "inclusive",
    "close_time", "bid", "ask", "bid_size", "ask_size", "last", "volume_24h", "volume_unit",
    "open_interest", "updated", "fair", "fair_method", "fee_taker", "fee_maker",
]  # fmt: skip


def distribution_row(d: Distribution, updated: str) -> list:
    stats = [d.median, d.q25, d.q75, d.mean, d.sd, d.vol, d.deribit_vol, d.spread]
    head = [d.venue, d.family, d.event, d.title, d.close, d.method, Jsonb(d.curve)]
    return [*head, *stats, updated]


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
    dists = distributions(listing["contracts"], listing.get("pairs", []), crypto, now)
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
        # Every 15 minutes (the timer fires at :30 past each minute), a liquidity sample.
        at = datetime.fromtimestamp(now, UTC).replace(second=0, microsecond=0)
        if at.minute % EVERY_MIN == 0:
            conn.cursor().executemany(
                "insert into manta.liquidity values (%s, %s, %s, %s, %s, %s, %s)"
                " on conflict do nothing",
                [(at, *s) for s in samples(listing["contracts"])],
            )
        conn.execute("delete from manta.distributions")
        conn.cursor().executemany(
            "insert into manta.distributions values"
            " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [distribution_row(d, listing["generated"]) for d in dists],
        )
        conn.execute("delete from manta.pairs")
        conn.cursor().executemany(
            "insert into manta.pairs values"
            " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [pair_row(p, listing["generated"]) for p in listing.get("pairs", [])],
        )
    print(
        f"stored {len(rows)} contracts ({len(fairs)} with a fair value),"
        f" {len(listing.get('pairs', []))} pairs, {len(dists)} distributions of"
        f" {listing['generated']}",
        end="",
    )
    for e in errors:
        print(f"; {e}", end="")
    print(f"; left out: {'; '.join(listing['errors'])}" if listing["errors"] else "")


if __name__ == "__main__":
    main()
