# Step 14: market maker, plan

**Status:** approved by Carson 2026-11-24 with two changes (below: more data before choosing quotes; latency measured from our server to Kalshi's production API). Next stop for approval: sub-step 4, the quoting rules. No strategy code before then.

**Expectation, set now:** with the fill rates measured below, the likely result is a strategy that earns little or loses a little to better-informed traders. That is an acceptable outcome; the deliverable is the honest profit-and-loss breakdown.

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

"Active" means quoted on both sides with a mid between 5¢ and 95¢. "Traded" is contracts × price. Over the six measured days (below) the same count gives KXBTC15M $5.92M an hour and KXBTCD $0.86M.

Recommendation: **KXBTCD**, because

1. it is where the trading is, so fills, queues and adverse selection can be measured with real sample sizes;
2. it is the only family whose fair value is independent of the Kalshi book (options-implied), so "does our fair value predict the next move?" is a real question; consensus fair values are built from the very book we would quote into;
3. the Nautilus catalog (`manta-catalog`) and fair values over recorded time (`manta-fair-series`) already exist and were validated for it (docs/milestone-4-backtest.md);
4. no maker fee (fee type `quadratic`, checked 2026-11-12).

KXBTC15M trades four times the dollars, but it is one contract at a time, has no validated fair value of ours, and its queue turns over in seconds: the same measurement (138 orders, too few to lean on) filled 78–88% of 1-contract orders within 10 s, against 5–8% on KXBTCD. Orders that fill that easily on a contract that tracks Bitcoin second by second are most likely being picked off by faster traders. So measurements 2 and 3 run on both KXBTCD and KXBTC15M, and the family is confirmed at sub-step 4 with adverse selection known.

The case against KXBTCD, stated plainly: professional firms keep KXBTCD at the 1¢ minimum spread almost all the time with deep queues, so a new maker earns at most 1¢ per round trip and waits at the back of long queues. The wide-spread families (S&P and Nasdaq hourly ranges, Fed levels) are the obvious second candidates; the same measurements run on them by changing `--series`.

**Data (Carson, 2026-11-24): measurements 1–3 share one sample of at least 5 days**, including a weekend and a volatile session, reported per day type and pooled with sample sizes. The VM keeps about a day of raw files; older days are on the Storage Box (archived nightly, 4–8 GB of Kalshi files a day). The Mac has too little free disk to hold them, so each day is streamed from the Storage Box (read-only, through series-1, which holds the box's key) into the measurement and never stored; only the small results are kept.

Days chosen, with Bitcoin's moves from the recorded Binance BTC/USDT 1-minute candles (realized volatility = the square root of the summed squared 1-minute log returns, annualized):

| Day (UTC) | Day type | Kalshi files | BTC range | Realized volatility | Largest 1-hour move |
|---|---|---|---|---|---|
| Tue 2026-11-17 | weekday | 6.4 GB | 3.3% | 52.9% | 2.4% |
| Wed 2026-11-18 | weekday | 6.8 GB | 4.7% | 49.4% | 2.2% |
| Thu 2026-11-19 | weekday | 7.0 GB | 4.3% | 52.9% | 1.8% |
| Sat 2026-11-21 | weekend | 5.0 GB | 10.6% | 91.1% | 5.1% |
| Sun 2026-11-22 | weekend | 4.2 GB | 4.9% | 57.6% | 2.5% |
| **Mon 2026-11-23** | **volatile** (whole day) | 7.8 GB | 7.0% | 82.3% | 5.1% (13:26 UTC) |

How the volatile session was chosen: of the archived weekdays (2026-11-16 to 11-23), 2026-11-23 has the highest realized volatility and the largest one-hour move. The three calmest weekdays (49–53%) are the normal weekdays. Weekends in the archive were all volatile (75–91% realized), so the weekend type is not a calm one; the table above lets each day be read on its own. Weekdays are split into US stock-market hours (14:30–21:00 UTC) and off-hours.

## Measurements before designing quotes

Each runs from the raw files through the existing normalizer (`recorder/cmd/normalize`: one YES book per market, sequence-checked, 0 mismatches on every run so far), one command each, with tests for every formula.

1. **Queue size and fill likelihood at the best price** (`manta-queue`, done below). Every minute, a hypothetical order at the best bid and the best ask of every active contract joins the back of the queue; recorded trades and size changes at its price move it forward. Reuses: normalize, `build_tools`. The book shows only total size per price, not who cancelled, so cancellations are split three ways (all behind us / proportional / all ahead of us) to give a pessimistic and an optimistic bound.
2. **Adverse selection by horizon.** For each simulated fill from measurement 1, the mid 10 s, 60 s and 5 min later, signed against us (we bought, the mid fell: a loss). Also for every recorded trade (who wins: the taker or the maker), which needs no queue model. Reuses: `manta-queue`'s books and fill times.
3. **Does our fair value's gap to the mid predict the next move?** KXBTCD only: our pricing has no model for KXBTC15M yet (pricing/table.py). From `manta-fair-series` (every 10 s) and the recorded mids: regress the mid's change over 10 s / 60 s / 5 min on (fair − mid), and the hit rate of its sign, by time to close. Context: the accuracy page measures our fair value as no more accurate than Kalshi's mid at settlement (Brier 0.1322 vs 0.1297 at 5 min), so the honest prior is "no"; a small short-horizon effect is still possible and is what quoting needs.
4. **Maker fees per series.** From the series' `fee_type` / `fee_multiplier` already stored in `manta.markets` (`fee_maker`); a table of which families charge makers. KXBTCD: none.

## Backtest design (NautilusTrader 2.0.0rc9)

- **Data:** the KXBTCD catalog (`manta-catalog`), with fair values from `manta-fair-series` fed in as custom data.
- **Exchange simulation:** Nautilus's simulated venue on L2 books (size per price, which is all Kalshi publishes). rc9 has a `queue_position` switch, `trade_execution` (fills from recorded trades) and `liquidity_consumption`, but no documentation in the package; its behaviour will be tested against `manta-queue`'s pessimistic and optimistic bounds on the same hours before it is trusted. If it falls outside them, we work around it in our code (a custom fill model) and report it to Carson for upstream.
- **Limits, stated now:** our orders never change the recorded market (no one reacts to them, and they never take others' place in the queue), so results are only meaningful for small sizes; queue position is an estimate between two bounds, and the report shows both.
- **Latency** (Carson, 2026-11-24: from our own server to Kalshi's production API, not the demo). The replay already sees each message when series-1 received it, so market data arrives as late as it really did. Each order and cancel is then delayed by the one-way trip to Kalshi, half the measured round trip: **56 ms** (median), with a sensitivity run at **2× (112 ms)**. Measured from series-1, read-only, no keys:
  - REST round trip on an open connection to Kalshi's origin: **112.4 ms median, 116.5 ms p90** (300 GET requests to the public markets endpoint, 1 a second, 2026-11-24 15:40 UTC; each with a unique query parameter, since Kalshi's API sits behind a CDN edge in Frankfurt that caches public GETs for 15 s: a first run without it timed mostly cache hits at 10 ms). Opening a new connection adds about 35 ms (148 ms median in all).
  - WebSocket, Kalshi's send time (`sending_ts_ms`) to our receive time: **52 ms median, 54 ms p90**; Kalshi's event time (`ts_ms`) to our receive time: **57–58 ms median, 60–61 ms p90** (2 million messages in each of 2026-11-23 13:00 and 19:00 UTC; series-1's clock is NTP-synced to within 10 µs).
  - Professional firms run next to Kalshi's servers (our server is in Helsinki; a 112 ms round trip fits Kalshi's servers being on the US east coast, which we have not confirmed), a millisecond or so away. They see every price change about 55 ms before us and their orders arrive about 55 ms sooner. That gap is part of adverse selection: when the price moves, they cancel or trade against stale orders first, and a slow maker's resting order is the stale one.
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

1. **This plan and measurement 1.** *Demo:* `manta-queue` on recorded hours, numbers below. Done 2026-11-23; re-run on six days 2026-11-25.
2. **Measurement 2, adverse selection.** *Demo:* a table of mid moves after fills, by horizon and day type. Done 2026-11-25.
3. **Measurement 3, fair value as a predictor.** *Demo:* the regression and hit-rate table by time to close. Done 2026-11-25.
4. **Quoting rules** chosen from 1–3, written up for Carson's approval. Drafted below; waiting for approval.
5. **Nautilus fill check:** `queue_position` against the measured bounds. *Demo:* the comparison table.
6. **Strategy and backtest report.** *Demo:* one command over a recorded week prints the profit-and-loss split, per day and per contract.
7. **Paper trading** on Kalshi demo (needs keys). *Demo:* the bot running, orders visible in the demo account.
8. **Results page.** *Demo:* the public page with paper results and the backtest beside them.

## Results: measurements 1–4 on six days

Commands (backtest/): `manta-queue --series KXBTCD,KXBTC15M [--volatile START/END] --out DAY.json --mids MIDS.parquet <one day's Kalshi files>` per day, `manta-queue-report DAY.json...` to pool them, `manta-fair-series` per day, then `manta-fair-predict --day DIR...`. Tests: backtest/tests/test_queue.py, test_predict.py (17, hand-worked). The six days, streamed in parallel, took about 4.5 hours of running on the Mac (spread over a day: the Mac slept part way).

**Data lost:** the Mac slept during the run and the download in progress was cut off, so 4.4 of 144 hours are missing (2026-11-19 08:00–10:00, 2026-11-21 16:00–17:00, 2026-11-23 07:20–09:00 UTC), found by counting the seconds of each hour that have a mid. A hole closes every order and markout spanning it (they are left out, not counted as unfilled), so the loss shrinks the sample without biasing it.

### 1. Queue size and fill likelihood (KXBTCD; KXBTC15M below)

Queue at the best price = the smaller of the two sides' sizes, every 10 s, on active contracts. Fill likelihood = share of hypothetical orders filled in full, pessimistic–optimistic (cancellations all behind us / all ahead of us).

| Day type | Queue samples | Queue quartiles (contracts) | 1¢ spread | Orders | 1 contract, 10 s | 1 contract, 60 s | 1 contract, 5 min | 100 contracts, 60 s |
|---|---|---|---|---|---|---|---|---|
| weekday US hours | 263,645 | 349 / 1,039 / 2,055 | 95.0% | 87,836 | 6.8–10.0% | 20.0–25.0% | 36.7–42.4% | 13.5–15.9% |
| weekday off-hours | 797,504 | 524 / 1,481 / 2,557 | 96.9% | 265,216 | 3.2–4.9% | 8.7–11.3% | 17.1–22.4% | 6.6–8.0% |
| weekend | 1,023,389 | 315 / 808 / 1,732 | 94.4% | 340,911 | 3.2–4.6% | 9.4–11.7% | 17.9–21.9% | 6.7–7.9% |
| volatile (11-23) | 443,022 | 618 / 1,636 / 2,869 | 95.8% | 147,360 | 3.6–5.3% | 10.5–13.1% | 19.5–23.7% | 7.3–8.7% |
| **pooled** | 2,527,560 | 400 / 1,132 / 2,230 | 95.5% | 841,323 | 3.6–5.4% | 10.5–13.2% | 19.9–24.5% | 7.5–8.9% |

By queue ahead when placed (pooled), 1 contract within 60 s: under 100: 28.4–30.1% (44,224 orders); 100–1,000: 17.5–20.0% (179,978); 1,000–10,000: 7.7–10.8% (558,043); 10,000 and more: 2.2–3.3% (59,078).

KXBTC15M (pooled, 8,701 orders): median queue 2,399, 1¢ spread 99.8%, and 74.8–81.6% filled within 10 s, 85.8–88.7% within 60 s (off-hours 77–80%, the other types 91–95%).

The first run (4 hours of 11-23, in the first version of this plan) gave 17.8–21.8% within 60 s. Those hours turned out to include the volatile day's busiest US-hours stretch; over six days the pooled figure is about half that.

### 2. Adverse selection (markouts)

A **markout** is what a maker's trade was worth some time later, in cents per contract: bought at p, worth (mid later − p); sold, (p − mid later). It splits into **spread earned** (mid just before the trade − p; the mid 1 s earlier, since Kalshi's book change can arrive before its trade) and **adverse selection** (mid later − that mid). ± is two standard errors. Mids are read on the recorded book; a horizon past the contract's close uses the last mid before the close.

**Every recorded KXBTCD trade, from the side of the resting order it hit** (no queue model; mostly the professional makers):

| Day type | Trades (60 s) | Spread earned | Adverse selection, 60 s | Total, 10 s | Total, 60 s | Total, 5 min |
|---|---|---|---|---|---|---|
| weekday US hours | 596,585 | +0.70 | −0.85 | −0.08 ± 0.04 | −0.15 ± 0.10 | +0.28 ± 0.17 |
| weekday off-hours | 968,220 | +0.77 | −0.91 | −0.12 ± 0.03 | −0.14 ± 0.06 | −0.19 ± 0.10 |
| weekend | 1,040,337 | +0.85 | −0.97 | −0.08 ± 0.03 | −0.12 ± 0.06 | −0.16 ± 0.10 |
| volatile | 506,323 | +0.90 | −0.87 | +0.03 ± 0.06 | +0.02 ± 0.10 | +0.34 ± 0.15 |
| **pooled** | 3,111,465 | +0.80 | −0.91 | −0.07 ± 0.02 | −0.11 ± 0.04 | −0.00 ± 0.06 |

**Our hypothetical orders that joined the back of the queue and never cancelled**, first fill, total markout (pessimistic queue / optimistic queue):

| | Fills (pessimistic, 60 s) | 10 s | 60 s | 5 min |
|---|---|---|---|---|
| KXBTCD, pooled | 167,353 | −1.16 / −0.61 | −1.29 / −0.73 | −1.33 / −0.77 |
| KXBTCD, weekday US hours | 32,665 | −1.28 | −1.32 | −1.56 |
| KXBTCD, weekday off-hours | 45,164 | −0.97 | −1.07 | −1.00 |
| KXBTCD, weekend | 60,902 | −1.17 | −1.36 | −1.36 |
| KXBTCD, volatile | 28,622 | −1.32 | −1.48 | −1.50 |
| KXBTC15M, pooled | 7,552 | −0.72 / −0.32 | −0.81 / −0.37 | −0.83 / −0.33 |

(Standard errors: ± 0.01–0.14¢ for KXBTCD, ± 0.15–0.80¢ for KXBTC15M. KXBTC15M's recorded trades: −0.05 ± 0.01 at 10 s, +0.03 ± 0.03 at 60 s.)

What this says:

- **The makers already there roughly break even on the average trade** at 10 s to 5 min: they earn about 0.8¢ of spread and give back about 0.9¢ when the price moves on. Whatever they earn comes from choosing which trades they keep (cancelling fast), not from the average fill.
- **A slow order at the back of the queue loses about 1¢ per contract filled on KXBTCD** (0.6–1.3¢ between the queue bounds), at every horizon and every day type. It gets filled mostly when the market has moved through its price, which is why its "spread earned" split comes out negative: by the time the last contract ahead of it trades, the mid has already moved. The total is the number to design from.
- **KXBTC15M loses less per fill** (0.3–0.8¢) and fills far more often, but it is a single contract that tracks Bitcoin second by second and has no fair value of ours.
- These orders never cancel, which a real maker would do. With our latency (data 57 ms late, orders 56 ms more to arrive) against about 1 ms for the firms next to Kalshi, our cancels would usually arrive after theirs, so the backtest has to show how much cancelling saves rather than assume it.

### 3. Does our fair value predict the next move? (KXBTCD)

2.4 million fair values (every 10 s per active contract) against the mid at that second and 10 s / 60 s / 5 min later. Slope: the share of the gap (fair − mid) that the mid closes on average; R²: the share of the moves this explains; hit rate: how often a gap of 1¢ or more points the right way (among rows where the mid moved).

| | n (60 s) | Slope 10 s | Slope 60 s | Slope 5 min | R² (60 s) | Hit rate 60 s (n) |
|---|---|---|---|---|---|---|
| weekday US hours | 255,942 | +0.009 | +0.007 | −0.074 | 0.000 | 52.0% (107,232) |
| weekday off-hours | 731,831 | +0.007 | +0.027 | +0.100 | 0.002 | 54.2% (172,265) |
| weekend | 967,589 | +0.003 | +0.008 | +0.024 | 0.000 | 51.7% (232,338) |
| volatile | 432,332 | +0.005 | +0.014 | +0.017 | 0.001 | 53.6% (115,694) |
| **pooled** | 2,387,694 | +0.004 | +0.012 | +0.030 | 0.001 | 52.8% (627,529) |

By time to close (pooled, 60 s): under 5 min +0.086 ± 0.081 (3,939); 5–15 min +0.031 ± 0.016; 15–60 min +0.019 ± 0.003; over 1 h +0.009 ± 0.000. Left out (no mid at the horizon): 1–4% of rows.

What this says: **our fair value carries almost no information the book does not already have.** The mid closes about 1% of the gap within a minute and 3% within 5 minutes; a 2¢ gap predicts a 0.06¢ move. The effect is statistically real (millions of rows) but far too small to pay for anything, and in US hours at 5 minutes it even points the wrong way. This matches the accuracy page (no more accurate than Kalshi's mid at settlement). Fair value can serve as a guard against quoting a stale price, not as a signal to lean on.

### 4. Maker fees

From `manta.markets` (fee rates per series), checked against Kalshi's live API for the series where docs disagreed (2026-11-24): no maker fee on any crypto, S&P, Nasdaq or FX family, KXCPICORE or KXCPICOREYOY; 0.0175 × P × (1 − P) on KXFED, KXFEDDECISION, KXCPI, KXCPIYOY, KXPAYROLLS and KXU3. Taker 0.07 × P × (1 − P) everywhere. KXBTCD and KXBTC15M: maker fee 0.

## Draft quoting rules (sub-step 4, for Carson's approval)

From the measurements; nothing here is built yet.

1. **Family:** KXBTCD stays the main backtest (validated catalog, 47 active contracts, fair value as a guard). KXBTC15M is run as a comparison with the same strategy (`--series`), because it fills seven to eight times as often and loses less per fill; the backtest report shows both.
2. **Join, never improve:** quote at the best bid and best ask only, 1–10 contracts (the measured queues are hundreds to thousands, so our size never matters to the book). At a 1¢ spread, improving would cross.
3. **Cancel on signs the level is going:** cancel and rejoin when the mid moves, or when the queue ahead of us falls below a threshold while trades eat it (measurement 2: back-of-queue fills come as the level is consumed). The threshold is chosen in the backtest, at 56 ms and 112 ms latency.
4. **Fair value only as a guard:** do not post a bid above fair value or an ask below it by more than 2¢ (measurement 3: no predictive value to lean on).
5. **No quotes in a contract's last 15 minutes** (fair value and price move fastest there; measurement 3's only noticeable slopes are there, with wide errors).
6. **Inventory:** at most 20 contracts per contract and 50 per hourly event (one Bitcoin bet); skew both quotes away from inventory by stepping back from the side we hold.

Expected result, stated before the backtest: a small loss per fill to adverse selection, partly offset by cancelling; the backtest's job is to measure how much.

## Measurement 1, first run (4 hours, 2026-11-23)

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
