"""Market maker, sub-steps 5-6: the pieces of the backtest that are plain arithmetic
(docs/plan-market-maker.md). Kept apart from the Nautilus strategy so each has a hand-checked test.

Terms: a fill is one of our orders trading; side +1 means we bought YES, -1 sold it. A contract
settles at V = $1 (YES) or $0 (NO).
"""

import math
from dataclasses import dataclass

from nautilus_trader.model import (
    AggressorSide,
    BookAction,
    OrderBookDelta,
    OrderSide,
    RecordFlag,
    TradeTick,
)

F_SNAPSHOT = RecordFlag.F_SNAPSHOT.value


def kalshi_fee(price: float, qty: float, rate: float) -> float:
    """Kalshi's fee: rate x contracts x P x (1 - P), rounded up to a whole $0.0001
    (docs/agent-reference.md). rate: 0.07 for takers, 0.0175 for makers where a series charges
    them, 0 otherwise (KXBTCD and KXBTC15M makers)."""
    raw = rate * qty * price * (1 - price)
    return math.ceil(round(raw * 10_000, 6)) / 10_000


def trades_first(
    deltas: list[OrderBookDelta], trades: list[TradeTick], window_ns: int = 1_000_000_000
) -> list[TradeTick]:
    """Kalshi sends a trade and the book change it causes in either order (the change first for
    58% of KXBTCD trades). Nautilus's queue model takes a trade off the queue ahead of us and also
    caps that queue at the level's new size, so a change that arrives first is counted twice.
    Give each trade that came after its size drop (same instrument, side and price, within
    `window_ns`) the receive time just before that drop, so it is replayed first.
    Both lists must be in receive-time order; returns the trades, re-timed, in time order."""
    drops: dict[tuple, list] = {}  # (instrument, side, price) → [[ts_init, size left], ...]
    sizes: dict[tuple, float] = {}
    out = []
    i = 0
    for t in trades:
        while i < len(deltas) and deltas[i].ts_init <= t.ts_init:
            d = deltas[i]
            i += 1
            if d.action == BookAction.CLEAR:
                for k in [k for k in sizes if k[0] == d.instrument_id]:
                    del sizes[k]
                continue
            key = (d.instrument_id, d.order.side, d.order.price.raw)
            new = 0.0 if d.action == BookAction.DELETE else d.order.size.as_double()
            old = sizes.get(key, 0.0)
            sizes[key] = new
            if new < old and not d.flags & F_SNAPSHOT:
                drops.setdefault(key, []).append([d.ts_init, old - new])
        side = OrderSide.BUY if t.aggressor_side == AggressorSide.SELL else OrderSide.SELL
        key = (t.instrument_id, side, t.price.raw)
        queue = drops.get(key, [])
        while queue and t.ts_init - queue[0][0] > window_ns:
            queue.pop(0)
        if queue:
            ts = queue[0][0] - 1
            queue[0][1] -= t.size.as_double()
            if queue[0][1] <= 1e-9:
                queue.pop(0)
            t = TradeTick(
                t.instrument_id, t.price, t.size, t.aggressor_side, t.trade_id, t.ts_event, ts
            )
        out.append(t)
    out.sort(key=lambda x: x.ts_init)
    return out


@dataclass
class Fill:
    """One fill and the three mids the split needs. mid_before: 1 s before the fill (before the
    trade's own book change); mid_after: 60 s later, or the settlement value if the contract
    closed first; settle: the contract's value at settlement ($1 or $0)."""

    ticker: str
    ts: int
    side: int
    price: float
    qty: float
    fee: float
    mid_before: float
    mid_after: float
    settle: float


def split(fills: list[Fill]) -> dict[str, float]:
    """Profit and loss in dollars, in four parts that add up to the total exactly:
    spread earned = side x (mid before - price), what we were paid to trade;
    adverse selection = side x (mid 60 s later - mid before), what the price did right after;
    inventory = side x (settlement - mid 60 s later), the rest of holding the position;
    fees. Total = side x (settlement - price) - fees, per fill: offsetting fills cancel, so the sum
    over all fills is the real profit and loss of holding every position to settlement."""
    out = dict.fromkeys(("spread", "adverse", "inventory", "fees", "total"), 0.0)
    for f in fills:
        out["spread"] += f.side * (f.mid_before - f.price) * f.qty
        out["adverse"] += f.side * (f.mid_after - f.mid_before) * f.qty
        out["inventory"] += f.side * (f.settle - f.mid_after) * f.qty
        out["fees"] -= f.fee
        out["total"] += f.side * (f.settle - f.price) * f.qty - f.fee
    return out
