# Market maker (step 14), plan and first measurement

## What
- docs/plan-market-maker.md: family choice, four measurements, backtest design, Kalshi demo
  paper trading, eight demoable sub-steps. No strategy code.
- `manta-queue` (backtest/src/manta_backtest/queue.py, 9 tests): queue size at the best price
  and fill likelihood of an order joining the back, with pessimistic/optimistic bounds.
- Run on 4 hours of 2026-11-23 (13–15, 19–21 UTC). KXBTCD: median queue 1,234 contracts; a
  1-contract order fills within 60 s 17.8–21.8% of the time, within 5 min 34.1–38.0%.
  KXBTC15M: 78–88% within 10 s (138 orders).

## Why
- Step 14 must be designed from measurements; fill likelihood is the first input.

## Decisions
- KXBTCD first: validated catalog and fair values, the only independent fair value, no maker
  fee. KXBTC15M trades 4× the dollars, so measurements 2–3 also run on it; the family is
  confirmed once adverse selection is known.
- Cancellations are invisible in L2 data, so three splits (behind / proportional / ahead) bound
  the answer; the bounds came out within a few points.
- Kalshi's trade and book messages arrive in either order, so each trade is matched to its size
  drop within 1 s instead of trusting arrival order (tested both ways).
- Python on the normalizer's output, like `manta-catalog`, rather than a new Go tool.

## Follow-ups
- Carson to approve the plan; then measurement 2 (adverse selection).
- Kalshi demo API keys needed at sub-step 7.
- Nautilus rc9 `queue_position` is undocumented in the package: test it against these bounds.
- 4 hours of one day only; widen to a week (Storage Box) before choosing quotes.
