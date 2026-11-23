# Agent reference — Manta

Details moved out of AGENTS.md (2026-11-21) to keep it short. AGENTS.md links here.

## Build order

### Done (2026-11-12 to 2026-11-13)

- **Recorder:** Kalshi BTC series, Deribit options and index, Coinbase, Kraken, Polymarket BTC daily contracts, Binance BTC/USDT; crash-safe, gaps logged, archived nightly. Must keep running: four weeks of recording is part of the definition of done.
- **Pricing engine:** options-implied fair value for Kalshi BTC contracts (docs/milestone-2-pricing.md).
- **Live tracker:** https://mantamarkets.com/tracker, Kalshi vs fair value, gap and accuracy statistics (docs/milestone-3-tracker.md).
- **Market-maker groundwork:** recordings → Nautilus catalog, fair values over recorded time, both validated (docs/milestone-4-backtest.md).

### Next (docs/product.md). Do these in order; each ends demoable.

0. **Brief and checks.** The agent brief (AGENTS.md), the product spec, and the data-terms checks.
1. **Coverage and data quality.** Record the new allow-listed series: ETH (Kalshi, Polymarket, Deribit), economics (Fed, CPI, payrolls, unemployment) and financials (S&P 500, Nasdaq-100, EUR/USD, USD/JPY), on Kalshi and on Polymarket where listed. Measure the added volume before deploying. **Demo:** a public data-quality page with every venue and contract family, coverage and gaps.
2. **Contract model and screener.** **Demo:** every covered contract in one filterable table.
3. **Contract page.** **Demo:** a live order book, chart, trades and settlement rules for any contract.
4. **Cross-venue view.** **Demo:** equivalent Kalshi and Polymarket contracts side by side.
5. **Fair values** on the screener and contract pages. **Demo:** fair value with its method on every contract.
6. **Cost-to-trade calculator and liquidity statistics.** **Demo:** the cost of N contracts, live.
7. **Implied distribution and term structure.** **Demo:** the distribution and term-structure charts.
8. **History and replay.** **Demo:** replay a past close minute by minute.
9. **Accuracy research page.** **Demo:** the extended statistics page.
10. **Waitlist and product shell**, only after the data-terms checks. **Demo:** a landing page with a working sign-up and a published privacy policy.
11. **Accounts, watchlists and alerts.** **Demo:** an alert firing on a real condition.
12. **API** of our analytics (no raw venue data). **Demo:** documented endpoints with keys.
13. **Market maker on the platform.** Designed from measurements (queue sizes, fill likelihood, adverse selection, whether our fair value predicts price moves), backtested with Nautilus on the recordings with profit and loss split into spread earned, losses to better-informed traders, and fees, then paper traded on Kalshi's demo environment. **Demo:** a backtest report from one command, then a paper-trading results page.

## Fees

M is the series fee multiplier, C the number of contracts, P the price in dollars (0.01–0.99).

- Kalshi (fee schedule "July 2026, 7.7.26 Update", read 2026-11-16): takers pay 0.07 × M × C × P × (1 − P), makers 0.0175 × M × C × P × (1 − P) only where a series charges them, rounded up so fee + position cost is a whole $0.0001; no settlement fee. Crypto, index and FX series are `quadratic` (no maker fee); Fed, CPI, payrolls and unemployment are `quadratic_with_maker_fees` (makers pay). The API's per-series `fee_type` and `fee_multiplier` are the live source (the PDF's list omits KXPAYROLLS, which the API marks with maker fees). Polymarket (docs.polymarket.com): takers pay rate × C × P × (1 − P), rate 0.07 crypto and 0.05 economics, from each market's `feeSchedule`; makers pay nothing.

## Infra

The VM `series-1` (Hetzner CX23, Helsinki, <vm-ip>; real values for every placeholder here are in `infra.local.md`, gitignored) runs the recorder and the snapshotter; recordings archive nightly to the Storage Box `manta-archive` (1 TB, <storagebox-user>); the site is the Vercel project `site` (team <vercel-team>, https://mantamarkets.com; domain registered at Namecheap 2026-11-21, DNS records there; www and mantamarkets.vercel.app redirect to it) on Supabase (us-east-2). Secrets live in `.env` (local), `/etc/manta/env` (VM) and Vercel's environment settings, never in git.
