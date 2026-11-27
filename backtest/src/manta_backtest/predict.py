"""Market maker, measurement 3: does our fair value's gap to the mid predict the mid's next move?
(docs/plan-market-maker.md)

    uv run manta-fair-predict --day DIR [--day DIR ...] [--volatile START/END]

Each DIR holds one recorded day's `fair.parquet` (manta-fair-series: our options-implied fair
value every 10 s), `mids.parquet` (manta-queue --mids: each active KXBTCD contract's mid every
second) and `markets.jsonl.gz` (the recorder's Kalshi listings, for close times).

For every fair value with a mid at the same second: gap = fair - mid, and move = the mid h
seconds later - the mid now (h = 10, 60, 300). If our fair value knows something the book does
not yet, the mid should move toward it: a positive slope of move on gap (1 would mean the whole
gap closes) and a sign hit rate above 50%. Rows whose contract has no mid h seconds later (it
stopped being active or closed) are left out and counted.

Terms: slope from an ordinary least-squares line (the straight line minimising squared misses);
R² is the share of the moves' variance that line explains; hit rate is the share of rows with a
gap of at least 1c and a nonzero move where the move has the gap's sign.
"""

import argparse
import json
import tempfile
from pathlib import Path

import pyarrow.parquet as pq
from manta_pricing.table import ts as iso_s

from manta_backtest.catalog import build_tools
from manta_backtest.fairseries import markets
from manta_backtest.queue import DAY_TYPES, HORIZONS_S, day_type, window

TTC_BUCKETS = ((300, "under 5 min"), (900, "5-15 min"), (3600, "15-60 min"), (None, "over 1 h"))


def ttc_bucket(seconds: float) -> str:
    """Time to close as a bucket label."""
    for hi, label in TTC_BUCKETS:
        if hi is None or seconds < hi:
            return label
    raise AssertionError


def add(acc: dict, key: str, gap: float, move: float) -> None:
    """Running sums for a least-squares line and a hit rate: [n, Σg, Σm, Σg², Σm², Σgm, hits,
    hit rows]."""
    a = acc.setdefault(key, [0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0])
    for i, v in enumerate((1, gap, move, gap * gap, move * move, gap * move)):
        a[i] += v
    if abs(gap) >= 0.01 - 1e-9 and move != 0:
        a[6] += (gap > 0) == (move > 0)
        a[7] += 1


def ols(a: list) -> tuple[float, float, float]:
    """Slope, its standard error, and R² of move on gap."""
    n, sg, sm, sgg, smm, sgm = a[:6]
    sxx = sgg - sg * sg / n
    sxy = sgm - sg * sm / n
    syy = smm - sm * sm / n
    if n < 3 or sxx <= 0:
        return float("nan"), float("nan"), float("nan")
    slope = sxy / sxx
    resid = max(syy - slope * sxy, 0.0)
    se = (resid / (n - 2) / sxx) ** 0.5
    return slope, se, (slope * sxy / syy if syy > 0 else float("nan"))


def measure_day(day: Path, closes: dict[str, float], volatile, acc: dict, censored: dict) -> None:
    mids: dict[str, dict[int, float]] = {}
    t = pq.read_table(day / "mids.parquet").to_pydict()
    for tk, sec, m in zip(t["ticker"], t["sec"], t["mid"], strict=True):
        mids.setdefault(tk, {})[sec] = m
    f = pq.read_table(day / "fair.parquet").to_pydict()
    for tk, ts, fair in zip(f["ticker"], f["ts"], f["fair"], strict=True):
        grid = mids.get(tk)
        sec = ts // 1_000_000_000
        if not grid or sec not in grid or tk not in closes:
            continue  # not active at this second
        m0 = grid[sec]
        b = ttc_bucket(closes[tk] - sec)
        dt = day_type(ts, volatile)
        for h in HORIZONS_S:
            later = grid.get(sec + h)
            if later is None:
                censored[str(h)] = censored.get(str(h), 0) + 1
                continue
            add(acc, f"{dt}|{b}|{h}", fair - m0, later - m0)


def report(acc: dict, censored: dict) -> str:
    out = [
        "| Day type | Time to close | Horizon | n | Slope ± 2 s.e. | R² | Hit rate (n) |",
        "|---|---|---|---|---|---|---|",
    ]
    labels = [label for _, label in TTC_BUCKETS]
    for dt in (*DAY_TYPES, "pooled"):
        for b in (*labels, "all"):
            for h in HORIZONS_S:
                rows = [
                    v
                    for k, v in acc.items()
                    if dt in ("pooled", k.split("|")[0])
                    and b in ("all", k.split("|")[1])
                    and k.split("|")[2] == str(h)
                ]
                if not rows:
                    continue
                a = [sum(r[i] for r in rows) for i in range(8)]
                slope, se, r2 = ols(a)
                hit = f"{a[6] / a[7]:.1%} ({a[7]:,})" if a[7] else "-"
                out.append(
                    f"| {dt} | {b} | {h} s | {a[0]:,} | {slope:+.3f} ± {2 * se:.3f} | "
                    f"{r2:.3f} | {hit} |"
                )
    out.append(f"\nLeft out, no mid at the horizon: {json.dumps(censored)}")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--day", action="append", required=True, type=Path)
    ap.add_argument("--volatile", action="append", default=[], help="UTC window START/END")
    a = ap.parse_args()
    volatile = [window(v) for v in a.volatile]
    acc: dict = {}
    censored: dict = {}
    with tempfile.TemporaryDirectory() as tmp:
        rawcat, _ = build_tools(Path(tmp))
        for day in a.day:
            listed = markets(rawcat, [str(day / "markets.jsonl.gz")], {"KXBTCD"})
            closes = {m["ticker"]: iso_s(m["close_time"]) for m in listed}
            measure_day(day, closes, volatile, acc, censored)
    print(report(acc, censored))


if __name__ == "__main__":
    main()
