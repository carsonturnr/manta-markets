# Step 14: market maker, plan

**Status:** plan for approval (2026-11-23). No strategy code until approved.

**Goal:** a Kalshi market maker designed from measurements, backtested with NautilusTrader on our recordings, then paper traded on Kalshi's demo environment, with profit and loss split into spread earned, losses to better-informed traders and fees. A good outcome does not require profit; it requires an honest account of where money was made and lost.

**Paper trading only.** Backtests, Nautilus's simulated exchange and Kalshi's demo environment. No live-money order path is built or enabled. Kalshi only for orders; every other venue read-only. No sports markets.

## Terms

- **Market maker:** a trader who keeps a buy order (a **bid**) and a sell order (an **ask**) resting in the order book, earning the gap between them when both trade.
- **Best bid / best ask:** the highest resting buy price / the lowest resting sell price. **Spread:** best ask − best bid. **Mid:** halfway between them.
- **Maker / taker:** the maker's order was resting; the taker's order arrived and traded with it. Kalshi charges takers 0.07 × P × (1 − P) per contract (P in dollars) and makers 0.0175 × P × (1 − P) only on series that charge them; crypto series do not.
- **Queue:** all the contracts resting at one price. Kalshi fills them first come, first served, so a new order joins the back and waits until everything ahead of it has traded or been cancelled. **Queue ahead:** the contracts in front of us.
- **Fill likelihood:** the share of resting orders that trade within a given time.
- **Adverse selection:** losing to better-informed traders. Someone sells to us just before the price falls; measured as the move of the mid after our fill, against us, at a few horizons.
- **Inventory:** the contracts we hold. A YES contract pays $1 if the event happens, else $0, so inventory is risk until the contract settles or we sell it.
- **Skew:** moving both our prices away from the side we already hold, so we are more likely to trade back toward zero inventory.
- **Fair value:** our estimate of the probability the contract pays $1. For Bitcoin contracts, from the options market (docs/milestone-2-pricing.md).

## Which markets first: KXBTCD (Bitcoin above/below, hourly and daily)

Measured on 4 recorded hours (2026-11-23, 13:00–15:00 and 19:00–21:00 UTC, `manta-queue`'s per-series trade count) and the liquidity page's 7 days of 15-minute samples:

| Family | Trades / hour | Traded / hour | Active contracts | Median spread | 1¢ spread | Median size at best |
|---|---|---|---|---|---|---|
| KXBTC15M (Bitcoin up/down, 15 min) | 128,871 | $5.15M | 1 | 1¢ | 99.6% | 3,277 |
| **KXBTCD** (Bitcoin above/below, hourly and daily) | 39,392 | $1.25M | 47 | 1¢ | 98.1% | 1,092 |
| KXINXU (S&P 500, hourly) | 1,498 | $374k | 345 | 35¢ | 0.3% | 53 |
| KXETH15M (Ether up/down, 15 min) | 13,774 | $368k | 1 | 1¢ | 84.0% | 220 |
| KXNASDAQ100U (Nasdaq-100, hourly) | 982 | $133k | 915 | 36¢ | 0% | 56 |
| KXETHD (Ether above/below) | 2,313 | $58k | 18 | 1¢ | 87.4% | 100 |
| everything else (Fed, CPI, jobs, FX, …) | under 300 each | under $32k each | | | | |

"Active" means quoted on both sides with a mid between 5¢ and 95¢. "Traded" is contracts × price.

Recommendation: **KXBTCD**, because

1. it is where the trading is, so fills, queues and adverse selection can be measured with real sample sizes;
2. it is the only family whose fair value is independent of the Kalshi book (options-implied), so "does our fair value predict the next move?" is a real question; consensus fair values are built from the very book we would quote into;
3. the Nautilus catalog (`manta-catalog`) and fair values over recorded time (`manta-fair-series`) already exist and were validated for it (docs/milestone-4-backtest.md);
4. no maker fee (fee type `quadratic`, checked 2026-11-12).

KXBTC15M trades four times the dollars, but it is one contract at a time, has no validated fair value of ours, and its queue turns over in seconds: the same measurement (138 orders, too few to lean on) filled 78–88% of 1-contract orders within 10 s, against 5–8% on KXBTCD. Orders that fill that easily on a contract that tracks Bitcoin second by second are most likely being picked off by faster traders. So measurements 2 and 3 run on both KXBTCD and KXBTC15M, and the family is confirmed at sub-step 4 with adverse selection known.

The case against KXBTCD, stated plainly: professional firms keep KXBTCD at the 1¢ minimum spread almost all the time with deep queues, so a new maker earns at most 1¢ per round trip and waits at the back of long queues. The wide-spread families (S&P and Nasdaq hourly ranges, Fed levels) are the obvious second candidates; the same measurements run on them by changing `--series`.

**Data:** the VM keeps about 12 hours of raw files; older hours are on the Storage Box (`<storagebox-user>`, see infra.local.md), archived nightly. The local catalog from Milestone 4 covered 2026-11-13 21:00–23:00 UTC and is not kept. Plan: measurements on a spread of hours (busy US morning, quiet evening, weekend), then a backtest week of KXBTCD pulled from the Storage Box (about 2–3 GB of Kalshi files a day for all series; `manta-catalog --series KXBTCD` keeps only KXBTCD).

## Measurements before designing quotes

Each runs from the raw files through the existing normalizer (`recorder/cmd/normalize`: one YES book per market, sequence-checked, 0 mismatches on every run so far), one command each, with tests for every formula.

1. **Queue size and fill likelihood at the best price** (`manta-queue`, done below). Every minute, a hypothetical order at the best bid and the best ask of every active contract joins the back of the queue; recorded trades and size changes at its price move it forward. Reuses: normalize, `build_tools`. The book shows only total size per price, not who cancelled, so cancellations are split three ways (all behind us / proportional / all ahead of us) to give a pessimistic and an optimistic bound.
2. **Adverse selection by horizon.** For each simulated fill from measurement 1, the mid 10 s, 60 s and 5 min later, signed against us (we bought, the mid fell: a loss). Also for every recorded trade (who wins: the taker or the maker), which needs no queue model. Reuses: `manta-queue`'s books and fill times.
3. **Does our fair value's gap to the mid predict the next move?** From `manta-fair-series` (every 10 s) and the recorded mids: regress the mid's change over 10 s / 60 s / 5 min on (fair − mid), and the hit rate of its sign, by time to close. Context: the accuracy page measures our fair value as no more accurate than Kalshi's mid at settlement (Brier 0.1322 vs 0.1297 at 5 min), so the honest prior is "no"; a small short-horizon effect is still possible and is what quoting needs.
4. **Maker fees per series.** From the series' `fee_type` / `fee_multiplier` already stored in `manta.markets` (`fee_maker`); a table of which families charge makers. KXBTCD: none.

## Backtest design (NautilusTrader 2.0.0rc9)

- **Data:** the KXBTCD catalog (`manta-catalog`), with fair values from `manta-fair-series` fed in as custom data.
- **Exchange simulation:** Nautilus's simulated venue on L2 books (size per price, which is all Kalshi publishes). rc9 has a `queue_position` switch, `trade_execution` (fills from recorded trades) and `liquidity_consumption`, but no documentation in the package; its behaviour will be tested against `manta-queue`'s pessimistic and optimistic bounds on the same hours before it is trusted. If it falls outside them, we work around it in our code (a custom fill model) and report it to Carson for upstream.
- **Limits, stated now:** our orders never change the recorded market (no one reacts to them, and they never take others' place in the queue), so results are only meaningful for small sizes; queue position is an estimate between two bounds, and the report shows both; latency is a fixed delay (to be set from the demo environment's measured round trip).
- **Fees:** a Nautilus fee model with Kalshi's formula (0 maker on KXBTCD; the taker formula for any closing trade that crosses), rounded as Kalshi rounds.
- **Quoting rules:** chosen from the measurements, not now. The candidates: join the best price only where measured fill likelihood × spread beats measured adverse selection; never quote better than fair value; skew by inventory; stop quoting a contract some minutes before its close (fair value moves fastest there; measurement 3 says how many).
- **Inventory limits:** a cap per contract and per hour's event (contracts of one close are near-duplicates of the same bet on Bitcoin), and a total dollar cap; sizes chosen from measured queue sizes.
- **Profit and loss split**, per fill, every part in dollars:
  - **spread earned** = (mid at fill − fill price) × size for a buy (reversed for a sell): what we earned for providing the trade, against the mid of that moment;
  - **adverse selection** = (mid at horizon − mid at fill) × size for a buy (reversed for a sell), at 60 s: what the price did to us right after;
  - **inventory** = the rest of the price change until the position is closed or settles (holding risk, kept separate so it does not hide in the other two);
  - **fees** = Kalshi's formula per fill.
  These add up to the total profit and loss exactly; a test checks it on a hand-worked sequence of fills.

## Paper trading on Kalshi demo

- **Needs:** Kalshi demo API keys (none yet; Carson to create them at the demo site), stored in `.env` / `/etc/manta/env` only. Nautilus's Kalshi adapter, demo environment, limit and post-only orders only.
- **Runs where:** first on the Mac, then (with Carson's go-ahead, it is a deploy) a systemd unit on the VM.
- **Recorded:** every order, cancel and fill with timestamps, to a local JSONL log, then a table in Postgres (a migration, so asked for first).
- **Shown:** a results page on the site: fills, inventory, the same profit-and-loss split, and the backtest's prediction for the same period beside it.
- **Caveat:** the demo environment's order book and traders are not the real ones, so demo fills say whether the plumbing works, not what real fills would be. The backtest on real recordings stays the measure of the strategy.

## Sub-steps, in order (each ends in a demo)

1. **This plan and measurement 1.** *Demo:* `manta-queue` on recorded hours, numbers below.
2. **Measurement 2, adverse selection.** *Demo:* a table of mid moves after fills, by horizon and queue position.
3. **Measurement 3, fair value as a predictor.** *Demo:* the regression and hit-rate table by time to close.
4. **Quoting rules** chosen from 1–3, written up for Carson's approval.
5. **Nautilus fill check:** `queue_position` against the measured bounds. *Demo:* the comparison table.
6. **Strategy and backtest report.** *Demo:* one command over a recorded week prints the profit-and-loss split, per day and per contract.
7. **Paper trading** on Kalshi demo (needs keys). *Demo:* the bot running, orders visible in the demo account.
8. **Results page.** *Demo:* the public page with paper results and the backtest beside them.

## Measurement 1 results

`uv run manta-queue --series KXBTCD <files>` (backtest/src/manta_backtest/queue.py, tests in backtest/tests/test_queue.py) on 4 recorded hours, 2026-11-23 13:00–15:00 and 19:00–21:00 UTC (a busy US morning and a quieter afternoon); 9.5 minutes on the Mac.

**Queue at the best price**, active contracts (quoted on both sides, mid 5–95¢), every 10 s, 73,797 samples: the smaller of the two sides' best-price size is **330 / 1,234 / 2,383 contracts** at the 25th / 50th / 75th percentile. The spread is 1¢ in **89.1%** of samples (the liquidity page's 15-minute samples over 7 days: 98.1%, median size 1,092).

**Fill likelihood** of an order joining the back of the queue at the best price: share filled in full within the horizon, as pessimistic – optimistic bounds (cancellations all behind us – all ahead of us; the proportional split lies between). 24,748 orders (one per side per active contract per minute); orders whose contract closed before a horizon are left out of that horizon.

| Queue ahead when placed | Orders (10 s) | 1 contract, 10 s | 1 contract, 60 s | 1 contract, 5 min | 100 contracts, 60 s | 100 contracts, 5 min |
|---|---|---|---|---|---|---|
| all | 24,206 | 5.3–8.0% | 17.8–21.8% | 34.1–38.0% | 11.6–13.6% | 25.8–28.0% |
| under 100 | 1,754 | 19.0–22.3% | 40.6–42.7% | 55.9–57.6% | 27.2–27.7% | 45.3–45.9% |
| 100–1,000 | 4,448 | 12.6–17.9% | 34.9–39.2% | 53.4–56.9% | 24.5–26.9% | 43.9–45.8% |
| 1,000–10,000 | 15,625 | 2.4–4.5% | 12.2–16.5% | 28.0–32.3% | 7.4–9.6% | 20.3–22.9% |
| 10,000 and more | 2,379 | 1.1–1.8% | 6.3–8.5% | 21.5–25.2% | 3.6–4.9% | 13.6–15.0% |

KXBTC15M on the same hours (`--series KXBTC15M`): queue 616 / 1,859 / 4,535 contracts, 1¢ spread in 99.8% of samples, and 78.3–88.4% of 1-contract orders filled within 10 s, 91.3–94.2% within 60 s (138 orders: the one contract is active only part of each 15 minutes).

What this says:

- **Most orders wait.** At the typical queue (1,000–10,000 ahead) a new 1-contract order is filled within a minute only 12–16% of the time, and within 5 minutes under a third of the time. A maker that joins the back and cancels when the price moves will rarely trade.
- **The bounds are close** (a few points apart), so the unknown of who cancels matters less than feared: most of a queue's progress is trades, which the data shows exactly.
- **Short queues fill far more often**, but a short queue usually means the price is about to move (the level is being eaten or abandoned). Whether those fills lose money is measurement 2's question: fill likelihood alone says nothing about profit.
- **Data checks:** 954 contracts of trades at our orders' prices (of millions traded) never met a matching size drop within 1 s; the normalizer reported 0 mismatches. Kalshi's trade and book messages arrive in either order (the book change first for 58% of trades, same Kalshi millisecond for 82%), so each trade is matched to its size drop within 1 s rather than trusting arrival order; a test checks both orders give the same queue.

Limits: 4 hours of one day; a hypothetical order that changes nothing (real makers would react to a new order); a 1-contract or 100-contract order only; no latency (the order is placed at the recorded moment).
