# Market maker (step 14): plan, measurements, Nautilus check, backtest

## What
- docs/plan-market-maker.md: plan (approved 2026-11-24), measurements 1–4 on six days, quoting
  rules (approved 2026-11-25), Nautilus fill check, tuning and backtest report, plain-English
  result at the top.
- backtest/: `manta-queue` (queue, fills, markouts, pick-offs, locked books), `manta-fair-predict`,
  `manta-mm-probe`, `manta-mm-backtest`, `manta-mm-report`; 29 hand-worked tests.
- Result: on the three reported days the bot lost $483 on 70,021 contracts (−0.69¢ a contract)
  against $0 for not quoting; spread +$351, adverse selection −$839. Lost on all six days.

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

## Follow-ups
- Sub-step 7 (paper trading on Kalshi demo) needs demo keys that only Carson can create.
- Two hours of 2026-11-19 are a recording gap in the archive (recorder restart).
- Nautilus limits order submissions only; cancels are not rate-limited in the backtest.
- Pricing has no KXBTC15M model; fair value adds nothing measurable on KXBTCD anyway.
- Long runs need mains power: the battery ran flat twice during this work.
