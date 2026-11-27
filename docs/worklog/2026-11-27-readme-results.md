# README: what worked and what did not

## What
- Rewrote the README's "What worked and what did not" section: Worked, Did not work, and a
  placeholder for paper-trading results.
- Worked: recorder message counts and coverage per venue, gaps logged, 0 book mismatches, the
  site's tools and API, event response (built; first real release 2026-12-04), arbitrage after
  fees, 187 tests.
- Did not: options fair value about as accurate as Kalshi's mid (Brier by horizon, with sample
  sizes), fair value barely predicts the next move, the market maker's out-of-sample loss per day,
  per contract and in dollars vs $0 for not quoting, and why; backtest limits, data lost, stale
  early tracker prices, the $22 brief.

## Why
- AGENTS.md's definition of done: the README states what worked and what did not, with real
  numbers, including unflattering ones.

## Decisions
- Recorder and accuracy figures come from read-only queries run 2026-11-27 (manta.quality,
  manta.predictions, scored as site/lib/stats.ts does), since the earlier README figures were not
  recorded in any file. Percentages are truncated, never rounded up.
- Market-maker numbers are marked provisional: backtest only, plan awaiting approval, 148 fills
  not yet settled. Its report is linked on its branch until that merges.
- Dropped the earlier "9 of 71 / about $6" arbitrage figures (no source in the repo) for the dated
  decisions entry (8 of 52 before fees, 7 after, 2026-11-25).

## Follow-ups
- When the market-maker branch merges: point the link at docs/plan-market-maker.md and refresh
  the numbers once its open fills settle.
- Fill the paper-trading placeholder after the Kalshi demo run.
- The "Numbers" section's 3.54 billion and 99.48% figures (2026-11-26) also have no source file;
  refresh them from the quality report or leave them dated.
