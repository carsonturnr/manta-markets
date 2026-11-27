"""Market maker, sub-step 7: paper trading on Kalshi's DEMO environment (docs/plan-market-maker.md).

    uv run --env-file ../.env manta-paper --log-dir DIR [--minutes N]
    uv run manta-paper --kill --log-dir DIR     # kill switch: cancel every order and stop
    uv run manta-paper-summary --log-dir DIR    # orders, fills, refusals, errors, P&L split

PAPER TRADING ONLY. The Kalshi environment is fixed to DEMO and checked before anything connects
(`require_demo`); the real account's key variables (KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY_PATH,
used by the recorder) are deleted from this process first, so nothing can fall back to them.
Only KALSHI_DEMO_API_KEY_ID and the PEM at KALSHI_DEMO_PRIVATE_KEY_PATH are used, and no key
value is ever printed or logged.

The strategy is the backtest's (strategy.MarketMaker, the chosen setting: cancel at half the
joined size, rejoin after 5 s) at a smaller size and total cap, under Kalshi's Basic-tier order
rate. Every order event, fill and error goes to DIR/YYYY-MM-DD.jsonl.

Demo fills are not real fills: the demo exchange has its own, thinner book and traders, so the
summary says whether the plumbing works, not what the strategy would earn on the real exchange.
"""

import argparse
import json
import os
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from manta_pricing.table import ts as iso_s

from manta_backtest.mm import Fill, split
from manta_backtest.strategy import KALSHI_RATE, MarketMaker, settlements

REAL_KEYS = ("KALSHI_API_KEY_ID", "KALSHI_PRIVATE_KEY_PATH")
# Kalshi's demo exchange (docs.kalshi.com); only its public market list is read directly here.
KALSHI_DEMO_API = "https://demo-api.kalshi.co/trade-api/v2"
KILL_FILE = "KILL"  # its presence in the log directory stops the bot
PAPER_SIZE = 1  # contracts per quote
PAPER_TOTAL = 20  # hard cap on total contracts held, resting orders counted
S = 1_000_000_000


def demo_credentials(env: dict) -> tuple[str, str]:
    """(key id, PEM text) for the demo account, after deleting the real account's variables from
    `env` (the process environment) so no client can fall back to them."""
    for k in REAL_KEYS:
        env.pop(k, None)
    key_id, path = env.get("KALSHI_DEMO_API_KEY_ID"), env.get("KALSHI_DEMO_PRIVATE_KEY_PATH")
    if not key_id or not path:
        raise SystemExit("KALSHI_DEMO_API_KEY_ID and KALSHI_DEMO_PRIVATE_KEY_PATH must be set")
    return key_id, Path(path).read_text()


def require_demo(environment) -> None:
    """Refuse to run against anything but Kalshi's demo exchange (paper trading only)."""
    from nautilus_trader.adapters.kalshi import KalshiEnvironment

    if environment != KalshiEnvironment.DEMO:
        raise SystemExit(f"refusing to run: Kalshi environment is {environment}, not DEMO")


class JsonlLog:
    """One JSON object per line, one file per UTC day."""

    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)

    def write(self, kind: str, **fields) -> None:
        now = datetime.now(UTC)
        rec = {"time": now.isoformat(), "kind": kind, **fields}
        with open(self.dir / f"{now:%Y-%m-%d}.jsonl", "a") as f:
            f.write(json.dumps(rec, default=str) + "\n")


class PaperMaker(MarketMaker):
    """MarketMaker with every order event logged, a kill switch, and cancel-all on stop."""

    def __new__(cls, *args, **kwargs):  # Nautilus's Rust-backed Strategy takes no arguments here
        return super().__new__(cls)

    def __init__(
        self, log: JsonlLog, closes_ns: dict[str, int], on_kill, stop_at_ns: int | None
    ) -> None:
        # No fair-value guard: our fair values are for the real exchange's contracts.
        super().__init__(0.5, 5 * S, closes_ns, {}, size=PAPER_SIZE, total=PAPER_TOTAL)
        self.log, self.on_kill, self.killed = log, on_kill, False
        self.stop_at = stop_at_ns

    def on_start(self) -> None:
        super().on_start()
        self.clock.set_timer_ns("kill-check", S)
        self.log.write("start", size=self.size, total_cap=self.total)

    def on_time_event(self, event) -> None:
        if self.killed:
            return
        if (self.log.dir / KILL_FILE).exists():
            self.kill("kill file")
        elif self.stop_at and self.clock.timestamp_ns() >= self.stop_at:
            self.kill("time limit")

    def kill(self, reason: str) -> None:
        self.killed = True
        self.log.write("kill", reason=reason)
        self.cancel_all()
        self.on_kill()

    def cancel_all(self) -> None:
        for inst in self.cache.instruments():
            self.cancel_all_orders(inst.id)

    def on_stop(self) -> None:
        self.cancel_all()
        self.log.write("stop", positions=self.pos | self.settled)

    def on_order_event(self, event) -> None:
        self.log.write(
            type(event).__name__,
            client_order_id=str(event.client_order_id),
            instrument=str(event.instrument_id),
            reason=str(getattr(event, "reason", "") or ""),
        )

    def on_order_filled(self, event) -> None:
        super().on_order_filled(event)
        if self.fills and self.fills[-1]["ts"] == event.ts_event:
            self.log.write("fill", **self.fills[-1])

    def settle_waiting(self, now: int) -> None:
        before = {i: f["mid_after"] for i, f in enumerate(self.fills)}
        super().settle_waiting(now)
        for i, f in enumerate(self.fills):
            if before.get(i) is None and f["mid_after"] is not None:
                self.log.write(
                    "markout", index=i, ticker=f["ticker"], ts=f["ts"], mid_after=f["mid_after"]
                )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--log-dir", required=True, type=Path)
    ap.add_argument("--kill", action="store_true", help="kill switch: stop a running bot")
    ap.add_argument(
        "--minutes", type=float, help="stop after this long (default: run until killed)"
    )
    ap.add_argument("--series", default="KXBTCD")
    ap.add_argument(
        "--environment", default="DEMO", help="for testing the startup check only; must be DEMO"
    )
    a = ap.parse_args()
    if a.kill:
        a.log_dir.mkdir(parents=True, exist_ok=True)
        (a.log_dir / KILL_FILE).touch()
        print(f"kill switch set: {a.log_dir / KILL_FILE}")
        return
    from nautilus_trader.adapters.kalshi import KalshiEnvironment

    environment = getattr(KalshiEnvironment, a.environment.upper(), a.environment)
    require_demo(environment)  # before any credential is read or any connection made
    key_id, pem = demo_credentials(os.environ)
    (a.log_dir / KILL_FILE).unlink(missing_ok=True)
    run(a.log_dir, key_id, pem, a.series, a.minutes)


def open_markets(series: str) -> list[dict]:
    """The demo exchange's open markets of `series` (tickers and close times)."""
    url = f"{KALSHI_DEMO_API}/markets?series_ticker={series}&status=open&limit=1000"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)["markets"]


def run(log_dir: Path, key_id: str, pem: str, series: str, minutes: float | None) -> None:
    from nautilus_trader.adapters.kalshi import (
        KalshiDataClientConfig,
        KalshiDataClientFactory,
        KalshiEnvironment,
        KalshiExecutionClientConfig,
        KalshiExecutionClientFactory,
    )
    from nautilus_trader.common import Environment
    from nautilus_trader.live import LiveNode, LiveRiskEngineConfig
    from nautilus_trader.model import InstrumentId, TraderId

    log = JsonlLog(log_dir)
    markets = open_markets(series)
    if not markets:
        raise SystemExit(f"no open {series} markets on Kalshi's demo exchange")
    ids = [InstrumentId.from_str(f"{m['ticker']}.KALSHI") for m in markets]
    closes = {m["ticker"]: int(iso_s(m["close_time"]) * S) for m in markets}
    env = KalshiEnvironment.DEMO
    require_demo(env)
    node = (
        LiveNode.builder("manta-paper", TraderId("MANTA-PAPER-001"), Environment.LIVE)
        .add_data_client(
            None,
            KalshiDataClientFactory(),
            KalshiDataClientConfig(
                api_key_id=key_id, private_key=pem, environment=env, instrument_ids=ids
            ),
        )
        .add_exec_client(
            None,
            KalshiExecutionClientFactory(),
            KalshiExecutionClientConfig(api_key_id=key_id, private_key=pem, environment=env),
        )
        .with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate=KALSHI_RATE))
        .build()
    )
    stop_at = time.time_ns() + int(minutes * 60 * S) if minutes else None
    node.add_strategy(PaperMaker(log, closes, node.stop, stop_at))
    log.write("connect", series=series, markets=len(markets), environment="DEMO")
    try:
        node.run()
    except Exception as e:
        log.write("error", error=repr(e))
        raise
    finally:
        log.write("exit")


def summary_main() -> None:
    ap = argparse.ArgumentParser(description="Summary of the paper bot's logs")
    ap.add_argument("--log-dir", required=True, type=Path)
    ap.add_argument("--out", type=Path, help="also write the summary as JSON")
    a = ap.parse_args()
    recs = [
        json.loads(line)
        for f in sorted(a.log_dir.glob("*.jsonl"))
        for line in f.read_text().splitlines()
        if line
    ]
    count = {}
    for r in recs:
        count[r["kind"]] = count.get(r["kind"], 0) + 1
    uptime, began = 0.0, None
    for r in recs:  # running time: each start to the next stop or exit
        t = datetime.fromisoformat(r["time"]).timestamp()
        if r["kind"] == "start":
            began = t
        elif r["kind"] in ("stop", "exit") and began is not None:
            uptime, began = uptime + t - began, None
    after = {(r["ticker"], r["ts"]): r["mid_after"] for r in recs if r["kind"] == "markout"}
    raw = [r for r in recs if r["kind"] == "fill"]
    settle = settlements({r["ticker"] for r in raw}, a.log_dir / "settle.json", KALSHI_DEMO_API)
    fills, open_ = [], 0
    for r in raw:
        mid_after = after.get((r["ticker"], r["ts"]))
        v = settle.get(r["ticker"])
        if v is None:  # not settled yet: valued at the mid 60 s after the fill
            open_ += 1
            v = mid_after if mid_after is not None else r["price"]
        before = r["mid_before"] if r["mid_before"] is not None else r["price"]
        after_ = mid_after if mid_after is not None else v
        fills.append(
            Fill(r["ticker"], r["ts"], r["side"], r["price"], r["qty"], 0.0, before, after_, v)
        )
    p = split(fills)
    out = {
        "orders_submitted": count.get("OrderSubmitted", 0),
        "orders_accepted": count.get("OrderAccepted", 0),
        "orders_canceled": count.get("OrderCanceled", 0),
        "refused_rate_limit": count.get("OrderDenied", 0),
        "rejected": count.get("OrderRejected", 0),
        "errors": count.get("error", 0),
        "fills": len(fills),
        "contracts": sum(f.qty for f in fills),
        "fills_not_yet_settled": open_,
        "uptime_hours": round(uptime / 3600, 2),
        "pnl": {k: round(v, 2) for k, v in p.items()},
        "note": "Demo fills are not real fills: Kalshi's demo exchange has its own book and "
        "traders, so this shows the bot works, not what it would earn on the real exchange.",
    }
    text = json.dumps(out, indent=1)
    print(text)
    if a.out:
        a.out.write_text(text)


if __name__ == "__main__":
    main()
