"""Milestone 4, step 2: our fair value for each Kalshi contract over recorded time
(docs/milestone-4-backtest.md).

    uv run manta-fair-series --out fair.parquet \\
        --kalshi ../data/raw/kalshi/2026-11-13/*.jsonl.gz \\
        --deribit ../data/raw/deribit/2026-11-13/*.jsonl.gz

The Milestone 2 pricing, fed by the recorder's Deribit messages instead of live REST calls:

- volatility: `markprice.options.btc_usd` sends only the options whose mark changed, with a full
  table of every option about every 5 minutes, so a running table keeps each option's latest
  implied volatility. Nothing is priced until a full table has arrived;
- forward price per expiry: `underlying_price` from the recorded option tickers (the two nearest
  expiries, the ones Kalshi's hourly and daily contracts are priced from);
- BTC price: Deribit's index.

Every `--every` seconds of recorded time, the surface is rebuilt and every open contract is
priced. Contract terms (strike, close time) come from the recorder's Kalshi market listings.
The output is a Parquet table: ticker, ts (ns), fair, index.
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from manta_pricing.surface import Surface
from manta_pricing.table import price, ts

from manta_backtest.catalog import build_tools, series_of


class DeribitState:
    """What the recorded Deribit messages say at the current moment of the replay."""

    def __init__(self) -> None:
        self.iv: dict[str, float] = {}  # option → mark implied volatility (fraction)
        self.forward: dict[str, float] = {}  # expiry code ("14NOV26") → forward price
        self.index: float | None = None
        self.listed = 0  # options in the latest instrument list
        self.warm = False  # a full volatility table has arrived

    def handle(self, rec: dict) -> None:
        if rec["stream"] == "instruments":
            self.listed = len(rec["msg"].get("result") or [])
            return
        if rec["stream"] != "ws":
            return
        params = rec["msg"].get("params") or {}
        channel, data = params.get("channel", ""), params.get("data")
        if channel == "deribit_price_index.btc_usd":
            self.index = data["price"]
        elif channel == "markprice.options.btc_usd":
            for o in data:
                self.iv[o["instrument_name"]] = o["iv"]
            # A message covering (nearly) every listed option is the periodic full table.
            if len(data) >= max(500, 0.9 * self.listed):
                self.warm = True
        elif channel.startswith("ticker."):
            self.forward[data["instrument_name"].split("-")[1]] = data["underlying_price"]

    def surface(self, now: float) -> Surface:
        """The Milestone 2 surface from the current state (Surface wants Deribit's book-summary
        shape: mark_iv in percent, underlying_price per option)."""
        summaries = [
            {"instrument_name": n, "mark_iv": iv * 100, "underlying_price": fwd}
            for n, iv in self.iv.items()
            if (fwd := self.forward.get(n.split("-")[1]))
        ]
        return Surface.from_deribit(summaries, now)


def records(rawcat: Path, files: list[str]):
    proc = subprocess.Popen([rawcat, *files], stdout=subprocess.PIPE, text=True)
    assert proc.stdout
    for line in proc.stdout:
        yield json.loads(line)
    proc.wait()


def markets(rawcat: Path, files: list[str], series: set[str]) -> list[dict]:
    """Each contract's latest recorded listing (its terms don't change)."""
    out: dict[str, dict] = {}
    for r in records(rawcat, files):
        if r["stream"] == "markets":
            for m in r["msg"].get("markets", []):
                if series_of(m["ticker"]) in series:
                    out[m["ticker"]] = m
    return list(out.values())


def fair_series(kalshi: list[str], deribit: list[str], series: set[str], every_s: float) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        rawcat, _ = build_tools(Path(tmp))
        contracts = [
            (m, ts(m["open_time"]), ts(m["close_time"])) for m in markets(rawcat, kalshi, series)
        ]
        state = DeribitState()
        cols: dict[str, list] = {"ticker": [], "ts": [], "fair": [], "index": []}
        next_at = None
        for r in records(rawcat, deribit):
            state.handle(r)
            t = r["recv_ns"] / 1e9
            next_at = next_at or t
            if t < next_at:
                continue
            next_at = t + every_s
            if not state.warm or state.index is None:
                continue
            surf = state.surface(t)
            for m, opens, closes in contracts:
                if not opens <= t < closes:
                    continue
                fair = price(m, surf, state.index, t)
                if fair is not None:
                    cols["ticker"].append(m["ticker"])
                    cols["ts"].append(r["recv_ns"])
                    cols["fair"].append(fair)
                    cols["index"].append(state.index)
    return cols


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--kalshi", nargs="+", required=True, help="raw Kalshi files (listings)")
    ap.add_argument("--deribit", nargs="+", required=True, help="raw Deribit files, time order")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--series", default="KXBTCD")
    ap.add_argument("--every", type=float, default=10, help="seconds between pricings")
    a = ap.parse_args()
    cols = fair_series(sorted(a.kalshi), sorted(a.deribit), set(a.series.split(",")), a.every)
    pq.write_table(pa.table(cols), a.out)
    n = len(cols["ts"])
    print(f"{n} fair values for {len(set(cols['ticker']))} contracts written to {a.out}")


if __name__ == "__main__":
    main()
