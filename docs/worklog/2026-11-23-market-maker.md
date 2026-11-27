# Market maker (step 14): plan, measurements, Nautilus check, backtest

## What
- docs/plan-market-maker.md: plan (approved 2026-11-24), measurements 1–4 on six days, quoting
  rules (approved 2026-11-25), Nautilus fill check, tuning and backtest report, plain-English
  result at the top.
- backtest/: `manta-queue` (queue, fills, markouts, pick-offs, locked books), `manta-fair-predict`,
  `manta-mm-probe`, `manta-mm-backtest`, `manta-mm-report`, `manta-paper` (Kalshi demo only, not yet
  run) and `manta-paper-summary`; 33 hand-worked tests.
- Result (settled, 2026-11-27): on the three reported days the bot lost $504 on 70,021 contracts
  (−0.72¢ a contract) against $0 for not quoting; spread +$351, adverse selection −$839. Lost on
  all six days. 112 ms: −$510; rate limit lifted (hypothetical): −$539; KXBTC15M: −$443.

## Why
- Step 14: a market maker designed from measurements, with an honest profit-and-loss split.

## Decisions
- KXBTCD first (validated catalog, independent fair value, no maker fee); KXBTC15M compared.
- Days streamed from the Storage Box via series-1 (Mac disk too small), never stored.
- Trades matched to their book change within 1 s (Kalshi sends them in either order).
- Pick-offs fill only with nothing left ahead; locked books (6.9% of crosses) are not fills.
- Nautilus 2.0.0rc9 used as is: its fills sit inside manta-queue's corrected bounds.
- Grid, choice rule and tuning/reported split fixed and pushed before any tuning run;
  chosen cancel 0.5 / rejoin 5 s on tuning days only, then run once on reported days.
- Kalshi's Basic-tier order rate (10 a second, verified in its docs) applied in the backtest.
- KXBTC15M stop window scaled to the last quarter of its life (3.75 min): the 15-minute rule
  sent zero orders on a 15-minute contract.
- Paper trading lean: JSONL logs and a summary command instead of a Postgres table (no migration).

## Follow-ups
- Sub-step 7: Mac smoke run, then the VM unit (Carson approved, with conditions), then summary.
- Two hours of 2026-11-19 are a recording gap in the archive (recorder restart).
- Nautilus limits order submissions only; cancels are not rate-limited in the backtest.
- Pricing has no KXBTC15M model; fair value adds nothing measurable on KXBTCD anyway.
- Long runs need mains power: the battery ran flat twice during this work.
