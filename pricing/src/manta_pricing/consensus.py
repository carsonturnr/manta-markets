"""Book consensus: a fair value from the venues' own quotes, for contracts with no outside reference
(economics, stock indexes, FX: docs/product.md, step 5).

A ladder of contracts on one number (CPI, the S&P 500 at 4 pm, …) describes one probability
curve: P(value > x) for each x. Every quote gives a point on that curve, but quotes are noisy and
can contradict each other ("above 4.1%" priced higher than "above 4.0%"). The consensus is the
curve that:

1. falls as x rises (a value above 4.1% is also above 4.0%), and
2. is as close as possible to the quotes, each weighted by how tight it is: weight 1/spread², so
   a 1¢ spread counts 100 times more than a 10¢ one.

Fitting a falling curve to weighted points is isotonic regression. The standard method, "pool
adjacent violators": walk the points from left to right; wherever a point is higher than the one
before it, merge the two into one block at their weighted average, and keep merging backwards
while blocks are still out of order. The result is the closest falling curve in weighted squared
distance.

Pure math on floats; no data access.
"""

from dataclasses import dataclass

# A quote with no bid counts as a bid of 0, no ask as an ask of 1: a one-sided quote still says
# something, and its wide "spread" gives it little weight.
MIN_SPREAD = 0.01  # a tick: no quote is treated as tighter than one cent


@dataclass(frozen=True)
class Point:
    """One quote's reading of the curve: P(value > x) ≈ p, with weight w."""

    x: float
    p: float
    w: float


def mid_and_weight(bid: float | None, ask: float | None) -> tuple[float, float]:
    """A quote's midpoint and weight 1/spread²."""
    b = 0.0 if bid is None else bid
    a = 1.0 if ask is None else ask
    spread = max(a - b, MIN_SPREAD)
    return (a + b) / 2, 1 / spread**2


def pooled(points: list[Point]) -> list[Point]:
    """One point per x, sorted: quotes at the same x (Kalshi's "above 3.7%" and Polymarket's
    buckets from 3.8% up) combined at their weighted average. x is rounded to 9 decimals first, so
    4.1 − 0.1 = 3.9999999999999996 and 4.0 count as the same strike."""
    sums: dict[float, list[float]] = {}
    for q in points:
        s = sums.setdefault(round(q.x, 9), [0.0, 0.0])
        s[0] += q.p * q.w
        s[1] += q.w
    return [Point(x, s / w, w) for x, (s, w) in sorted(sums.items())]


def falling_fit(points: list[Point]) -> list[Point]:
    """Isotonic regression: the falling curve closest to the points (weighted), one point per x."""
    pts = pooled(points)
    # Blocks of [x's, weighted sum, total weight]; each block's value is sum / weight.
    blocks: list[list] = []
    for q in pts:
        blocks.append([[q.x], q.p * q.w, q.w])
        # A later block above an earlier one breaks "falling": merge until in order.
        while len(blocks) > 1 and blocks[-1][1] / blocks[-1][2] > blocks[-2][1] / blocks[-2][2]:
            xs, s, w = blocks.pop()
            blocks[-1][0] += xs
            blocks[-1][1] += s
            blocks[-1][2] += w
    weight = {q.x: q.w for q in pts}
    return [Point(x, s / w, weight[x]) for xs, s, w in blocks for x in xs]


def curve_at(fit: list[Point], x: float) -> float | None:
    """P(value > x) from the fitted curve: linear between fitted points, None outside them (no
    extrapolation: beyond the quoted strikes there is no consensus)."""
    x = round(x, 9)
    if not fit or x < fit[0].x - 1e-9 or x > fit[-1].x + 1e-9:
        return None
    for a, b in zip(fit, fit[1:], strict=False):
        if a.x - 1e-9 <= x <= b.x + 1e-9:
            if b.x - a.x < 1e-12:
                return a.p
            return a.p + (b.p - a.p) * (x - a.x) / (b.x - a.x)
    return fit[0].p  # a single point, at x


def normalized(outcomes: dict[str, list[tuple[float | None, float | None]]]) -> dict[str, float]:
    """Mutually exclusive outcomes (the Fed's decision): each outcome's quotes, possibly from both
    venues, combined by weight 1/spread², then scaled so the outcomes sum to 1."""
    raw = {}
    for name, quotes in outcomes.items():
        mws = [mid_and_weight(b, a) for b, a in quotes]
        total = sum(w for _, w in mws)
        raw[name] = sum(m * w for m, w in mws) / total
    s = sum(raw.values())
    return {k: v / s for k, v in raw.items()} if s > 0 else {}
