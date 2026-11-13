# Milestone 2: pricing engine, plan and method

**Goal:** for every live Kalshi Bitcoin contract, a fair probability computed from Deribit's option prices, shown next to Kalshi's price.

**Demo:** `uv run manta-fair` prints a live table: contract, strike, time to close, Kalshi bid/ask, our fair value, and the gap.

## What a contract pays (read from Kalshi's API, 2026-11-13)

- **KXBTCD "above" contract:** pays $1 if *the simple average of the 60 seconds of the CF Benchmarks BTC index (BRTI) before the close* is above the strike. Example: `KXBTCD-26NOV1314-T68899.99` closes 2026-11-13 19:00 UTC, strike $68,899.99.
- **KXBTC "range" contract:** pays $1 if that same average lands between a floor and a cap. For example, $68,800 to $68,899.99.

So a fair price is a probability: the chance the 60-second average ends above K (or in [K1, K2]).

## Method: the simplest sound version, with each step's reason

1. **Price today.** Use Deribit's BTC index as the current BTC price `S`. It is a multi-exchange average like the BRTI. The recorder also keeps Coinbase and Kraken spot, so we can later measure how far it sits from the BRTI.
2. **How much BTC tends to move: volatility.** An option's price implies a volatility `σ`: the market's estimate of how much BTC will swing, per year. Deribit publishes it per strike and expiry (the "implied vol"). Different strikes give different `σ`; that curve is the **smile**.
3. **The timing mismatch, one of the brief's hard parts.** Kalshi contracts close within hours. Deribit's nearest expiry is the next 08:00 UTC, up to a day away.
   - **Start:** use the volatility of the first Deribit expiry *after* the Kalshi close, at the contract's strike. In other words, assume BTC's volatility per unit of time is the same over the next few hours as over the next day.
   - **Past the first expiry:** when the Kalshi close is later than the first Deribit expiry, interpolate *total variance* (σ²·T, the quantity that adds up over time) between the two neighboring expiries.
   - **Known weakness, to measure rather than assume away:** BTC is more volatile at some hours of the day than others (around US market hours and data releases).
4. **The 60-second average, the other hard part.** An average moves less than a single price. For a random walk, averaging over the last `w` = 60 s before the close leaves a variance of `σ²·(τ − 2w/3)` in place of `σ²·τ`, where τ is the time to close. That's a small effect hours out and a large one in the final minutes. Inside the final 60 seconds, part of the average is already known, so the table shows those contracts without a fair value.
5. **Probability above K.** With today's price, the volatility and the time, the standard log-normal model gives `P(above K) = N(d₂)`, where `d₂ = (ln(S/K) − v/2)/√v` and `v = σ²·τ_eff`. `N` is the bell-curve cumulative probability. Interest over a few hours is negligible (about 0.0005% for an hour at 4%/year), so the forward price is `S`.
6. **Smile correction.** Because `σ` changes with the strike, the exact chance of finishing above K from option prices is `N(d₂) − vega·∂σ/∂K`. Here `vega` is how much an option's price moves per unit of volatility, and `∂σ/∂K` is the smile's slope at K. Without this term, prices drift systematically off on the steep parts of the smile.
7. **Range contract.** `P(K₁ < A ≤ K₂) = P(A > K₁) − P(A > K₂)`, each side with its own strike's volatility.

## Out of scope for Milestone 2 (measure first, then improve if the numbers say so)

- intraday volatility seasonality;
- a BRTI-versus-Deribit-index basis;
- fees;
- KXBTC15M.

Each becomes a measured improvement only if the gap statistics in Milestone 3 show it matters (brief: "improve it only when measurements show it is needed").

## Tests (hand-checked inputs and outputs)

- At the money, with no time left, the answer is 50/50.
- Far in or far out of the money, it goes to 1 or 0.
- Prices fall as the strike rises; ranges are never negative; a full ladder of ranges sums to 1.
- The averaging window lowers the variance by exactly 2w/3 of the time.
- The smile correction has the right sign: with downside skew, the "above" probability rises.
- One fully worked example, computed by hand in the test's comments.
