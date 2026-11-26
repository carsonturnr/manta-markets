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

### Tuning result and choice (2026-11-26, before any reported-day run)

The six pre-registered settings, KXBTCD, 56 ms latency, on the three tuning days (`manta-mm-backtest`, then `manta-mm-report`; settlement values from Kalshi's public API). Every setting loses money on every tuning day.

| Setting (cancel below this fraction of the size we joined; rejoin wait) | 2026-11-17 | 2026-11-19 | 2026-11-21 | **Total** |
|---|---|---|---|---|
| 0 (never on shrinking); 0 s, and 0; 5 s (identical: the wait only follows such a cancel) | −$563.43 | −$636.85 | −$526.38 | −$1,726.66 |
| 0.25; 0 s | −$443.80 | −$480.80 | −$516.03 | −$1,440.63 |
| 0.25; 5 s | −$243.83 | −$216.97 | −$196.67 | −$657.47 |
| 0.5; 0 s | −$490.30 | −$467.19 | −$463.54 | −$1,421.03 |
| **0.5; 5 s (chosen)** | −$222.90 | −$211.43 | −$193.56 | **−$627.89** |

**Chosen: cancel when the size at our price falls below half of what it was when we joined, then wait 5 s before rejoining.** By the rule fixed beforehand (best total over the tuning days); the next best, 0.25 with 5 s, is $29.58 behind.

What the tuning days already say, for reading the reported days:

- **Every setting loses to adverse selection.** Spread earned is $112–$480 a day; adverse selection (the mid's move in the 60 s after each fill) takes $269–$1,072. Inventory (the rest of the move until settlement) is small; maker fees are 0.
- **Less trading loses less in dollars but more per contract**: the chosen setting trades about a quarter as many contracts as never cancelling (20,000–24,000 a day against 77,000–98,000) and loses 0.88–1.10¢ a contract against 0.63–0.73¢. Cancelling when the level thins avoids some bad fills but also gives up the queue position that the better fills need.
- **Kalshi's order rate binds**: with no rejoin wait, more than half of the orders sent are refused at 10 a second (e.g. 119,479 of 195,101); the 5 s wait cuts that to about one in five.
- Positions reach about 150 contracts (three hourly events at the 50 cap) on every day; the 200 total cap never binds.
- Some fills are in contracts that close after 2026-11-26 (38–67 a day on 11-21); they are valued at their mid 60 s after the fill until Kalshi settles them.

Full report of the 18 runs:

| Set | Run | Orders sent | Refused at the rate limit | Fills | Contracts | Spread earned | Adverse selection | Inventory | Fees | Total | Total per contract | Peak position |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-17 | mm-tune-f0-r0 | 89,035 | 38,030 | 17,126 | 77,325 | $+420.47 | $-945.56 | $-38.34 | $+0.00 | $-563.43 | -0.73¢ | 149 |
| 2026-11-17 | mm-tune-f0-r5 | 89,035 | 38,030 | 17,126 | 77,325 | $+420.47 | $-945.56 | $-38.34 | $+0.00 | $-563.43 | -0.73¢ | 149 |
| 2026-11-17 | mm-tune-f0.25-r0 | 111,757 | 57,627 | 12,215 | 55,070 | $+319.20 | $-722.45 | $-40.56 | $+0.00 | $-443.80 | -0.81¢ | 150 |
| 2026-11-17 | mm-tune-f0.25-r5 | 39,190 | 6,033 | 5,364 | 23,769 | $+131.67 | $-319.17 | $-56.33 | $+0.00 | $-243.83 | -1.03¢ | 150 |
| 2026-11-17 | mm-tune-f0.5-r0 | 146,929 | 78,647 | 13,198 | 58,921 | $+340.07 | $-814.90 | $-15.47 | $+0.00 | $-490.30 | -0.83¢ | 149 |
| 2026-11-17 | mm-tune-f0.5-r5 | 38,506 | 4,377 | 4,543 | 20,182 | $+114.18 | $-272.68 | $-64.41 | $+0.00 | $-222.90 | -1.10¢ | 150 |
| 2026-11-19 | mm-tune-f0-r0 | 126,134 | 68,656 | 20,920 | 97,994 | $+480.19 | $-1,072.35 | $-44.68 | $+0.00 | $-636.85 | -0.65¢ | 150 |
| 2026-11-19 | mm-tune-f0-r5 | 126,134 | 68,656 | 20,920 | 97,994 | $+480.19 | $-1,072.35 | $-44.68 | $+0.00 | $-636.85 | -0.65¢ | 150 |
| 2026-11-19 | mm-tune-f0.25-r0 | 162,715 | 96,893 | 15,726 | 73,317 | $+394.11 | $-841.89 | $-33.02 | $+0.00 | $-480.80 | -0.66¢ | 150 |
| 2026-11-19 | mm-tune-f0.25-r5 | 42,054 | 7,651 | 5,566 | 25,928 | $+129.95 | $-291.39 | $-55.53 | $+0.00 | $-216.97 | -0.84¢ | 149 |
| 2026-11-19 | mm-tune-f0.5-r0 | 195,101 | 119,479 | 14,902 | 69,609 | $+373.97 | $-775.67 | $-65.49 | $+0.00 | $-467.19 | -0.67¢ | 150 |
| 2026-11-19 | mm-tune-f0.5-r5 | 49,538 | 8,726 | 5,017 | 23,584 | $+125.25 | $-281.55 | $-55.12 | $+0.00 | $-211.43 | -0.90¢ | 149 |
| 2026-11-21 | mm-tune-f0-r0 | 123,832 | 65,167 | 18,119 | 84,144 | $+370.95 | $-895.92 | $-1.41 | $+0.00 | $-526.38 | -0.63¢ | 149 | (56 fills not yet settled, valued at their mid)
| 2026-11-21 | mm-tune-f0-r5 | 123,832 | 65,167 | 18,119 | 84,144 | $+370.95 | $-895.92 | $-1.41 | $+0.00 | $-526.38 | -0.63¢ | 149 | (56 fills not yet settled, valued at their mid)
| 2026-11-21 | mm-tune-f0.25-r0 | 156,173 | 88,652 | 15,669 | 73,273 | $+348.94 | $-812.31 | $-52.65 | $+0.00 | $-516.03 | -0.70¢ | 150 | (67 fills not yet settled, valued at their mid)
| 2026-11-21 | mm-tune-f0.25-r5 | 42,416 | 10,985 | 5,268 | 24,391 | $+118.32 | $-314.53 | $-0.46 | $+0.00 | $-196.67 | -0.81¢ | 148 | (38 fills not yet settled, valued at their mid)
| 2026-11-21 | mm-tune-f0.5-r0 | 159,710 | 88,981 | 14,257 | 66,400 | $+323.82 | $-752.98 | $-34.38 | $+0.00 | $-463.54 | -0.70¢ | 149 | (67 fills not yet settled, valued at their mid)
| 2026-11-21 | mm-tune-f0.5-r5 | 44,660 | 10,340 | 4,699 | 21,994 | $+112.29 | $-269.42 | $-36.44 | $+0.00 | $-193.56 | -0.88¢ | 150 | (43 fills not yet settled, valued at their mid)

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
5. **Nautilus fill check:** `queue_position` against the measured bounds. *Demo:* the comparison table. Done 2026-11-25 (below).
6. **Strategy and backtest report.** *Demo:* one command over a recorded week prints the profit-and-loss split, per day and per contract.
7. **Paper trading** on Kalshi demo (needs keys). *Demo:* the bot running, orders visible in the demo account.
8. **Results page.** *Demo:* the public page with paper results and the backtest beside them.

## Results: measurements 1–4 on six days

Commands (backtest/): `manta-queue --series KXBTCD,KXBTC15M [--volatile START/END] --out DAY.json --mids MIDS.parquet <one day's Kalshi files>` per day, `manta-queue-report DAY.json...` to pool them, `manta-fair-series` per day, then `manta-fair-predict --day DIR...`. Tests: backtest/tests/test_queue.py, test_predict.py (17, hand-worked). The six days, streamed in parallel, took about 4.5 hours of running on the Mac (spread over a day: the Mac slept part way).

**Data:** measurements 1–2 were re-run 2026-11-25 on the same six days with the corrected fill rule (pick-offs, sub-step 5 below), this time with the Mac kept awake: 142 of 144 hours. The missing 2 hours (2026-11-19 08:00–10:00 UTC) are a gap in the recording itself (the archived files hold 3–4 MB instead of 140–270 MB; the recorder restarted at 09:31), not a download problem. Measurement 3 used the first run (4.4 hours lost then to the Mac sleeping: 2026-11-19 08:00–10:00, 2026-11-21 16:00–17:00, 2026-11-23 07:20–09:00 UTC). A hole closes every order and markout spanning it (left out, not counted as unfilled), so it shrinks the sample without biasing it.

**Correction (2026-11-25):** the first version of measurements 1–2 counted a fill only when a trade reached our order. It missed **pick-offs**: the queue ahead of a resting order empties (the fast makers cancel) and a seller then arrives at the order's price, which a real exchange matches with our stale order but which prints no trade at our price. Counting them roughly doubles fill likelihood; the tables below are the corrected ones, with the first version's pooled figures in brackets.

### 1. Queue size and fill likelihood (KXBTCD; KXBTC15M below)

Queue at the best price = the smaller of the two sides' sizes, every 10 s, on active contracts. Fill likelihood = share of hypothetical 1-contract orders filled in full, pessimistic–optimistic (cancellations all behind us / all ahead of us).

| Day type | Queue samples | Queue quartiles (contracts) | 1¢ spread | Orders | 10 s | 60 s | 5 min | 100 contracts, 60 s |
|---|---|---|---|---|---|---|---|---|
| weekday US hours | 263,645 | 349 / 1,039 / 2,055 | 95.0% | 87,836 | 16.1–19.1% | 35.8–39.6% | 57.0–61.0% | 35.5–37.1% |
| weekday off-hours | 797,504 | 524 / 1,481 / 2,557 | 96.9% | 265,216 | 6.4–7.9% | 17.9–20.1% | 38.2–42.0% | 17.7–18.7% |
| weekend | 1,049,225 | 314 / 807 / 1,719 | 94.3% | 349,628 | 7.2–8.5% | 17.1–18.9% | 32.2–35.1% | 16.9–17.8% |
| volatile (11-23) | 470,638 | 628 / 1,656 / 2,906 | 95.9% | 156,497 | 8.8–10.4% | 21.0–22.9% | 39.4–42.3% | 20.8–21.8% |
| **pooled** | 2,581,012 | 399 / 1,129 / 2,234 | 95.4% | 859,177 | 8.1–9.7% (3.6–5.4%) | 20.0–22.1% (10.5–13.2%) | 37.9–41.2% (19.9–24.5%) | 19.8–20.8% (7.5–8.9%) |

By queue ahead when placed (pooled), 1 contract within 60 s: under 100: 41.8–42.9% (45,134 orders); 100–1,000: 28.5–30.5% (184,292); 1,000–10,000: 16.8–19.2% (569,544); 10,000 and more: 7.8–8.7% (60,207).

**Opposite side reaching an order's price** (first episode per order): picked off (filled) 298,311 / locked book with size still ahead (not filled) 21,951, a locked share of **6.9%** in the pessimistic model (2.5% optimistic); by day type 4.1–8.3% (pessimistic).

KXBTC15M (pooled, 8,867 orders): median queue 2,399, 1¢ spread 99.8%, and 74.9–81.8% filled within 10 s, 85.8–88.9% within 60 s (off-hours 77–80%, the other types 91–96%).

### 2. Adverse selection (markouts)

A **markout** is what a maker's trade was worth some time later, in cents per contract: bought at p, worth (mid later − p); sold, (p − mid later). It splits into **spread earned** (mid just before the trade − p; the mid 1 s earlier, since Kalshi's book change can arrive before its trade) and **adverse selection** (mid later − that mid). ± is two standard errors. Mids are read on the recorded book; a horizon past the contract's close uses the last mid before the close.

**Every recorded KXBTCD trade, from the side of the resting order it hit** (no queue model; mostly the professional makers; unchanged by the correction):

| Day type | Trades (60 s) | Spread earned | Adverse selection, 60 s | Total, 10 s | Total, 60 s |
|---|---|---|---|---|---|
| weekday US hours | 596,585 | +0.70 | −0.85 | −0.08 ± 0.04 | −0.15 ± 0.10 |
| weekday off-hours | 968,220 | +0.77 | −0.91 | −0.12 ± 0.03 | −0.14 ± 0.06 |
| weekend | 1,066,126 | +0.85 | −0.96 | −0.07 ± 0.03 | −0.11 ± 0.05 |
| volatile | 524,263 | +0.89 | −0.87 | +0.02 ± 0.05 | +0.02 ± 0.10 |
| **pooled** | 3,155,194 | +0.80 | −0.91 | −0.07 ± 0.02 | −0.10 ± 0.04 |

**Our hypothetical orders that joined the back of the queue and never cancelled**, first fill, total markout in cents (pessimistic queue model; pooled also optimistic):

| | Fills (60 s) | 10 s | 60 s | 5 min |
|---|---|---|---|---|
| KXBTCD, pooled (pessimistic / optimistic) | 326,135 | −0.64 / −0.39 | −0.74 / −0.48 | −0.77 / −0.52 |
| KXBTCD, weekday US hours | 50,745 | −0.68 | −0.75 | |
| KXBTCD, weekday off-hours | 100,997 | −0.61 | −0.65 | |
| KXBTCD, weekend | 112,430 | −0.65 | −0.78 | |
| KXBTCD, volatile | 61,963 | −0.65 | −0.78 | |
| KXBTC15M, pooled (pessimistic / optimistic) | 7,707 | −0.73 / −0.31 | −0.81 / −0.37 | −0.84 / −0.35 |

(Standard errors ± 0.01–0.04¢ for KXBTCD, ± 0.15–0.80¢ for KXBTC15M. First version, KXBTCD pooled at 60 s: −1.29 / −0.73.)

What this says:

- **The makers already there roughly break even on the average trade** at 10 s to 5 min: about 0.8¢ of spread earned and about 0.9¢ given back as the price moves on. Whatever they earn comes from choosing which trades to keep (cancelling fast), not from the average fill.
- **A slow order at the back of the queue loses about 0.5–0.8¢ per contract filled on KXBTCD**, in every day type. Its "spread earned" comes out slightly negative because it is mostly filled after the price has started moving through it; the total is the number to design from.
- **KXBTC15M fills far more often** (86–89% within 60 s) and loses a similar 0.4–0.8¢ per fill, with much wider errors; it has no fair value of ours.
- These orders never cancel, which a real maker would. With our latency (data 57 ms late, orders 56 ms more to arrive) against about 1 ms for the firms next to Kalshi, our cancels usually arrive after theirs; the backtest measures how much cancelling saves.

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

## Quoting rules (sub-step 4)

Approved 2026-11-25 by the coordinating session (Carson delegated the market-maker decisions to it), with two changes, written in below: parameters are tuned on three days and reported on the other three, and a total exposure cap is back.

1. **Family:** KXBTCD stays the main backtest (validated catalog, 47 active contracts, fair value as a guard). KXBTC15M is run as a comparison with the same strategy (`--series`), because it fills far more often; the backtest report shows both. (The approved draft also said it loses less per fill; after the 2026-11-25 correction to measurement 2 it loses about the same, 0.4–0.8¢.)
2. **Join, never improve:** quote at the best bid and best ask only, 1–10 contracts (the measured queues are hundreds to thousands, so our size never matters to the book). At a 1¢ spread, improving would cross.
3. **Cancel on signs the level is going:** cancel and rejoin when the mid moves, or when the queue ahead of us falls below a threshold while trades eat it (measurement 2: back-of-queue fills come as the level is consumed). The threshold is chosen in the backtest, at 56 ms and 112 ms latency.
4. **Fair value only as a guard:** do not post a bid above fair value or an ask below it by more than 2¢ (measurement 3: no predictive value to lean on).
5. **No quotes in a contract's last 15 minutes** (fair value and price move fastest there; measurement 3's only noticeable slopes are there, with wide errors).
6. **Inventory:** at most 20 contracts per contract and 50 per hourly event (one Bitcoin bet), and **at most 200 contracts in total across all contracts** (long and short counted alike); skew both quotes away from inventory by stepping back from the side we hold. Why 200: a Kalshi contract costs at most $1 and pays $0 or $1, so no position can lose more than $1 a contract; 200 contracts caps the worst case (every position wrong at once) at $200, the same figure as the project's hard cap for any future live trading. It is also far below the queues (median 1,132 contracts), so our orders stay small against the book.

**Tuning and reporting split, fixed before any backtest runs (2026-11-25).** Any parameter chosen in the backtest (rule 3's cancel threshold, the rejoin rule, the skew size) is chosen on the **tuning days** only, and profit and loss is reported on the **reported days**, which are run once, with the chosen parameters, after the choice is written down. Both are shown side by side.

| Set | Days | Day types |
|---|---|---|
| Tuning (in-sample) | Tue 2026-11-17, Thu 2026-11-19, Sat 2026-11-21 | two weekdays, one weekend day |
| Reported (out-of-sample) | Wed 2026-11-18, Sun 2026-11-22, **Mon 2026-11-23 (volatile)** | one weekday, one weekend day, the volatile day |

The choice is the setting with the best total profit and loss over the tuning days, across a small grid written down before the first run; ties go to the simpler setting. 2026-11-19 lost 2 hours (08:00–10:00 UTC) in the measurement run and is re-streamed for the backtest.

Expected result, stated before the backtest: a small loss per fill to adverse selection, partly offset by cancelling; the backtest's job is to measure how much.

### Sub-step 5: Nautilus fills against manta-queue (2026-11-25)

Same data for both: KXBTCD, 2026-11-23 13:00–15:00 UTC (part of a reported day, used only for this check, no profit and loss). Orders of 1 contract joining the back of the queue at the best bid and ask of every active contract, held 5 minutes, no latency.

| Filled within | manta-queue, first version (trades only) | manta-queue, corrected (pessimistic–optimistic) | Nautilus `queue_position` |
|---|---|---|---|
| 10 s | 5.2–7.9% | 17.2–20.3% | 19.6% |
| 60 s | 18.7–22.7% | 37.2–40.1% | 38.7% |
| 5 min | 37.2–41.1% | 59.5–61.9% | 59.1% |

By queue ahead within 60 s, Nautilus vs corrected bounds: under 100: 59.0% vs 57.9–59.4%; 100–1,000: 59.0% vs 56.0–59.3%; 1,000–10,000: 33.0% vs 32.1–35.3%; 10,000 and more: 18.9% vs 16.3–18.2%. **Nautilus sits inside the corrected bounds**, so the backtest uses its simulated exchange as is. How we got there:

1. **On hand-made books Nautilus behaves like manta-queue's pessimistic model**: it takes trades off the queue ahead, caps the queue when the level shrinks below it, and clears it when the level is deleted.
2. **manta-queue missed the worst fills.** When the queue ahead of a resting order empties (the fast makers cancel) and a seller then arrives at the order's price, a real exchange matches that seller with our stale order; no trade prints at our price in the recording, so the first version never counted it. manta-queue now fills on such a cross only when nothing is left ahead of us (corrected 2026-11-25 per the coordinating session): while the book still shows size ahead of us at the same price as the opposite side, the recorded book is locked by message order, which is counted, not filled. Locked share of crossing episodes on these hours: 13.0% (pessimistic model), 4.8% (optimistic). Nautilus with `queue_position` on does not fill a locked book with size ahead (checked on a hand-made book) and does fill the pick-off.
3. **A probe bug, not a simulator one:** placing hundreds of orders at one instant tripped Nautilus's order-rate check, which refused them (RATE_LIMIT_EXCEEDED) before they reached the exchange; they were first counted as unfilled. The probe now bypasses that check. The strategy keeps one at Kalshi's rate (below).
4. **Trade order:** replaying each trade before the size drop it caused (mm.trades_first) changes Nautilus's fills by about 1 point; kept, since Nautilus otherwise counts such a trade twice.

**Order rate:** Kalshi meters writes in tokens; the Basic tier has 100 write tokens a second and an order costs 10, so about 10 orders a second (cancels also cost 10; Advanced, 30 a second, needs one prior API order) (docs.kalshi.com, rate limits, read 2026-11-25). The strategy runs under a 10 orders a second limit; refused orders are counted. Nautilus's check limits submissions only, so cancels are not limited in the backtest.

### Backtest setup, fixed before any tuning run (2026-11-25)

- **Grid (rule 3 and the rejoin rule):** cancel when the size at our price falls below a fraction of what it was when we joined, fraction ∈ {0 (never on shrinking), 0.25, 0.5}; after such a cancel, wait ∈ {0 s, 5 s} before rejoining. Six settings, each run on the three tuning days.
- **Choice:** the setting with the best total profit and loss summed over the three tuning days (KXBTCD); a tie goes to the simpler setting (lower fraction, then shorter wait). Written into this plan before the reported days run.
- **Fixed, not tuned:** 5 contracts per quote; step back one cent at a position of 10 (half the per-contract cap); fair-value guard 2¢; no quotes in the last 15 minutes; caps 20 / 50 / 200; latency 56 ms per order (from series-1's measured round trip), with the chosen setting also run at 112 ms on the reported days.
- **KXBTC15M comparison:** the chosen setting, same days, no fair-value guard (we have no model for it), reported beside KXBTCD; it is not used to choose anything.
- **Development data, disclosed:** the strategy and the Nautilus check were debugged on 2026-11-23 13:00–15:00 UTC, part of a reported day, with one fixed setting; only fill counts and run time were looked at there, never profit and loss. Debugging from here on uses tuning days only.

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
