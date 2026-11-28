# Manta: product spec

**Decided 2026-11-13, refined 2026-11-15** (docs/decisions.md). Manta is **an analytics terminal for prediction markets**: tools for finding contracts, reading their order books, comparing venues, pricing them, and costing a trade. A market maker is built on top of it last.

**No sports markets, ever**.

## Who it's for

Traders and researchers on Kalshi and Polymarket who want one place to find contracts, see real liquidity, compare venues and price trades. It launches as a public site with a waitlist; accounts unlock watchlists, alerts and the API.

## Coverage

| Category | Kalshi | Polymarket | Fair value from |
|---|---|---|---|
| **Crypto** (BTC, ETH) | above/below and range contracts, hourly and daily | daily "above" and "price on" contracts | **the options market** (Deribit), our model (docs/milestone-2-pricing.md) |
| **Economics** (Fed decisions, CPI, payrolls, unemployment) | the decision and release ladders | where listed | **venue consensus**: both books, depth-weighted and net of fees |
| **Financials** (S&P 500, Nasdaq-100, EUR/USD, USD/JPY) | range and above/below contracts | where listed | **venue consensus** (an options-implied value later if an affordable data source exists) |

Every series and every Polymarket event pattern is on an explicit allow-list, checked against the venue's category at startup and refused if anything about it is sports. Category labels alone aren't enough: Kalshi files a series called "Football Fun" under Crypto.

## Tools

**Find**
1. **Screener.** Every covered contract in one searchable, sortable table, filtered by venue, category, expiry, spread, volume, depth, and distance from fair value.

**Look at one contract**
2. **Contract page.** Live order book (size at each price), price chart, recent trades, fair value, and the settlement rules in plain English (what price it settles on, averaged how, at what time).
3. **History and replay.** The full-resolution order book, trades and fair value of any contract, replayed minute by minute from our recordings. Kalshi doesn't provide historical order books, so this exists only because we record it.

**Compare**
4. **Cross-venue view.** The same event on Kalshi and Polymarket, with the price difference after adjusting for their different settlement rules. Example: Kalshi BTC settles on the 60-second average of the CF Benchmarks index at 22:00 UTC; Polymarket BTC on the Binance BTC/USDT 1-minute close at noon New York time.

**Price**
5. **Fair value.** Options-implied for BTC and ETH; a book consensus for everything; always labelled with its method.
6. **Implied distribution and volatility term structure.** A ladder of strikes or ranges read as the market's probability distribution (for BTC at a time, the CPI print, the Fed's rate), with its mean and spread; for crypto and indices, the volatility each horizon implies, next to Deribit's for crypto.

**Trade smarter**
7. **Cost-to-trade calculator.** What buying or selling N contracts costs right now: average price after walking the book (slippage), plus the venue's fees. Also spread and depth statistics by time to close and hour of day.

**Trust the data**
8. **Data-quality page.** The recorder's live status: venues, coverage, gaps, validation results.
9. **Accuracy (research page).** Each venue's prices and our fair values scored against settled outcomes (calibration, Brier score), with honest sample sizes.

**Accounts**
10. **Accounts** (the waitlist came first and was retired 2026-11-26).
11. **Watchlists and alerts.** Save contracts; get notified when a condition is met (e.g. Kalshi and Polymarket differ by 5¢, the spread widens, depth disappears).
12. **Trader workspace** (/terminal). One full-screen screen of panels a trader keeps open: a market monitor, chart, live order book and depth, trade tape with large trades flagged, event board, liquidity (spread, depth near the mid, book imbalance) and a cost ticket; plus what only Manta has: fair value with its own track record beside it, a cross-venue arbitrage scanner that walks both books after fees, the implied distribution, alerts from any panel, and a catalyst calendar of the releases contracts settle on. Preset layouts and a ⌘K command bar. Books and trades are polled every 2 seconds at first; a WebSocket relay from the recorder makes them live.
13. **API.** Our analytics (fair values, distributions, cost-to-trade, cross-venue differences) with keys and rate limits. No redistribution of raw venue data.

**Proposed (Carson, 2026-11-23): react to events**
15. **Event response.** For each scheduled economic release (payrolls, unemployment, CPI, the Fed's decision), how every contract still trading moved, how fast (seconds to 90% of the move), and how its order book thinned before the number. From our recordings only. Plan: docs/plan-event-response.md.
16. **News events.** Unscheduled news from official sources (Fed, Treasury, BEA, Labor Department, BLS; no paid feed), placed on the same clock as the order book, with the book move around each item against the 30 minutes before. Done 2026-11-27 (/insights/news).

**On top**
14. **Market maker.** Designed from measurements (queue sizes, fill likelihood, adverse selection), backtested on the recordings with NautilusTrader. Done 2026-11-27: it loses money (docs/plan-market-maker.md). Paper trading on Kalshi's demo environment was dropped (Carson, 2026-11-27); no live-money order path.

## Build order

Each step ends in something that runs and can be shown.

0. This spec and the rewritten brief; the data-terms checks below.
1. Coverage and data quality: the new allow-listed series and venues recorded, the added volume measured, the public data-quality page.
2. Contract model and screener.
3. Contract page.
4. Cross-venue view.
5. Fair values (screener and contract page).
6. Cost-to-trade calculator and liquidity statistics.
7. Implied distribution and term structure.
8. History and replay.
9. Accuracy research page.
10. Waitlist and product shell (after the data-terms checks).
11. Accounts, watchlists and alerts.
12. Trader workspace.
13. API.
13b. Event response (proposed 2026-11-23; first real release in our data: 2026-12-04).
13c. News events (done 2026-11-27).
14. Market maker.

## Must be checked before the waitlist goes public

- **Data terms for a commercial product** (settled: Carson confirmed 2026-11-17 that the venues allow it): Kalshi, Polymarket, Deribit and Binance, for showing their data and analytics derived from it, and for an API of derived analytics. Kalshi's earlier permission covered displaying data in a non-commercial project. No bulk redistribution of raw venue data in any case.
- **Personal data:** waitlist and account emails stored with row-level security, a published privacy policy, deletion on request.

## Costs to approve when reached

- A bigger VM, or a separate database server, when the database outgrows the recorder VM (it moved there from Supabase on 2026-11-27).
- A second small server for history and replay (the recorder's server already uses up to 2.6 GB of its 4 GB of memory).
- More Storage Box space: 1 TB lasts about 8 months at today's 3.8 GB/day, less with new coverage.
- An email-sending service for alerts (free tiers exist).
