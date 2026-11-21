# CLAUDE.md — Manta

This file briefs Claude Code on this project. Read it fully before doing anything.

## Status

This project **replaces Series** (earlier names: "event-terminal", "private-exchange"). Series is retired. Do not continue its roadmap: no private-company exchange, no custom Rust matching engine, no perpetual futures, no margin system, no guest trading.

Series failed on scope. It kept growing and nothing was ever demoable. The rule for this project is the opposite: **every step ends in something that runs and can be shown.**

**Reframed 2026-11-13** (Carson's decision, docs/decisions.md): Manta started as a Kalshi market maker. It is now **an analytics terminal for prediction markets** (refined 2026-11-15: tools, not predictions), with the market maker built on top last. The product spec is [docs/product.md](docs/product.md). The first three milestones (recorder, pricing engine, live tracker) are done and carry over; so does the market-maker groundwork (docs/milestone-4-backtest.md).

Before writing new code, look through the existing repo for anything reusable, from Series or from earlier Manta milestones. Report what you find and ask before deleting or rewriting it.

Project name: **Manta** (repo and package name: `manta-markets`, because another app already uses `Manta`). It pairs with Nautilus, the engine its market maker is built on, and a manta feeds by steadily filtering many tiny things from the water: the product filters a flood of tiny market updates into a few numbers worth knowing, and the market maker earns a fraction of a cent across many trades.

## What this project is

Prediction markets (Kalshi, Polymarket) sell yes/no contracts on events: "Will Bitcoin be above $85,000 at 5pm?", "Will the Fed cut rates in December?". A contract costs 1 to 99 cents and pays $1 if yes, so its price is the crowd's probability. The same event is often listed on more than one venue, priced differently, settled on different prices at different times, and traded in thin order books.

Manta is a set of tools for crypto, economics and financial contracts on those venues:

- **Find:** a screener of every covered contract, filtered by venue, category, expiry, spread, volume, depth and distance from fair value.
- **Look:** a contract page with the live order book, price chart, trades, fair value and plain-English settlement rules; full-resolution history and replay from our own recordings (Kalshi doesn't provide historical order books, so this data exists only because we record it).
- **Compare:** the same event on Kalshi and Polymarket, adjusted for their different settlement rules.
- **Price:** a fair value per contract, from the options market where one exists (Deribit, for Bitcoin and Ether), otherwise a consensus of the venues' own order books, always labelled; each ladder of strikes read as the market's probability distribution and volatility term structure.
- **Trade smarter:** what buying or selling N contracts actually costs, after slippage and fees.
- **Trust the data:** a public data-quality page and an accuracy research page.
- **With an account:** watchlists, alerts and an API of our analytics.

Then, on top of that data: **a market maker on Kalshi**, backtested on the recordings and paper traded.

Analogy: a trading terminal for a young, fast-moving market. It shows what each contract is worth, where it's cheaper, how much is really available and what a trade would cost. Later the same shop uses those tools to trade.

## Why it exists

For the market maker, a good outcome does not require profit. Professional firms quote these Kalshi markets nearly full time (spreads sit at the 1¢ minimum, measured 2026-11-13), so it may lose a little or break even. What matters is a clear explanation of where money was made and lost.

## How to work with Carson

- **Every part must be explainable.** Prefer simple, readable code over clever code. When you add a non-obvious piece (a formula, a model, a concurrency pattern), explain it in plain English in your reply and in a short comment.
- **Plain language.** Define any finance or math term the first time you use it. No unexplained jargon.
- **Small steps.** One step at a time. Do not build ahead.
- **Take a position.** When there is a design choice, recommend one option and say why. Do not list five options and stop.
- **No scope creep.** If an idea is not in the build order below, propose it and wait. Do not start it.
- **Say what you verified and what you did not.** Never report something as working unless you ran it.

## Built on NautilusTrader

The trading engine is [NautilusTrader](https://github.com/nautechsystems/nautilus_trader), used as an installed library. We do not write our own engine.

- **Use it openly and credit it.** The README must state the project uses NautilusTrader.
- **Never copy Nautilus source into this repo as our own code.** It is LGPL-3.0. Import it, do not paste it.
- **What Nautilus provides:** the data catalog for history, backtesting, the event loop, order handling, and the Kalshi adapter for paper trading on Kalshi's demo environment.
- **What we write:** the recorder, the pricing and analytics, the product site, the raw→catalog converter, the market-making strategy and its measurement.
- If you find a bug or gap in a Nautilus adapter, tell Carson. A fix contributed upstream is valuable, but it goes through their contribution process, not a private patch.

## Build order

### Done (2026-11-12 to 2026-11-13)

- **Recorder:** Kalshi BTC series, Deribit options and index, Coinbase, Kraken, Polymarket BTC daily contracts, Binance BTC/USDT; crash-safe, gaps logged, archived nightly. Must keep running: four weeks of recording is part of the definition of done.
- **Pricing engine:** options-implied fair value for Kalshi BTC contracts (docs/milestone-2-pricing.md).
- **Live tracker:** https://mantamarkets.com/tracker, Kalshi vs fair value, gap and accuracy statistics (docs/milestone-3-tracker.md).
- **Market-maker groundwork:** recordings → Nautilus catalog, fair values over recorded time, both validated (docs/milestone-4-backtest.md).

### Next (docs/product.md). Do these in order; each ends demoable.

0. **Brief and checks.** This file, the product spec, and the data-terms checks below.
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

## Money and safety rules (non-negotiable)

- **Paper trading only** (Carson, 2026-11-13): backtests, Nautilus's sandbox, and Kalshi's demo environment. Don't build or enable a live-money order path until Carson raises it himself.
- **If Carson ever approves live trading:** explicit go-ahead in the current session, live mode behind a deliberate flag and never the default, a hard capital cap (default $200) enforced in code with a kill switch that cancels all orders and stops the bot.
- **Kalshi only for orders.** Deribit, Polymarket, Binance and every other source are read-only. Never place an order on them.
- **No sports markets, ever.** Record, display and trade only crypto, economics and financial contracts, each series or event pattern on an explicit allow-list checked against the venue's category. Category labels alone are not enough (Kalshi files a "Football Fun" series under Crypto). Do not add sports series even for testing.
- **Secrets:** API keys live in environment variables or a local untracked file. Never commit them, never print them in logs.
- **Personal data:** waitlist and account email addresses are stored with row-level security, covered by a published privacy policy, deletable on request, and never logged or committed.

## Facts to verify before relying on them

**Checked 2026-11-12/13** against the live APIs (docs/decisions.md):
- Kalshi KXBTCD and KXBTC list hourly events about an hour ahead, plus daily (22:00 UTC) and weekly closes; KXBTC15M is 15-minute. All `Crypto`, settled on the 60-second average of the CF Benchmarks index (BRTI).
- Fees (Kalshi fee schedule "July 2026, 7.7.26 Update", read 2026-11-16): takers pay 0.07 × M × C × P × (1 − P), makers 0.0175 × M × C × P × (1 − P) only where a series charges them, rounded up so fee + position cost is a whole $0.0001; no settlement fee. Crypto, index and FX series are `quadratic` (no maker fee); Fed, CPI, payrolls and unemployment are `quadratic_with_maker_fees` (makers pay). The API's per-series `fee_type` and `fee_multiplier` are the live source (the PDF's list omits KXPAYROLLS, which the API marks with maker fees). Polymarket (docs.polymarket.com): takers pay rate × C × P × (1 − P), rate 0.07 crypto and 0.05 economics, from each market's `feeSchedule`; makers pay nothing.
- Kalshi KXBTCD spreads: 96–99% of snapshots at the 1¢ minimum.
- Kalshi's market list trails the live order book by up to about a minute; read prices from the order book.
- Polymarket's BTC daily contracts settle on the Binance BTC/USDT 1-minute close at noon New York time. Binance's main host refuses US users; its public data host `data-stream.binance.vision` works.
- NautilusTrader 2.0.0rc9 includes the Kalshi adapter (data, limit-order execution, demo and production environments). It is a release candidate: expect bugs.
- Deribit: daily BTC options expire 08:00 UTC; public market data needs no account.
- Kalshi gave permission to display its data publicly, confirmed by Carson for the tracker.
- Deribit ETH options (checked 2026-11-16): daily 08:00 UTC expiries like BTC, about 21 strikes within ±10% of the index, $10 apart; the BTC method applies unchanged.
- Binance BTC/USDT and ETH/USDT traded about 0.1% above Deribit's index (2026-11-16); Polymarket's crypto fair values use Binance's price for that reason.

- **Data terms for a commercial product** (Kalshi, Polymarket, Deribit, Binance): Carson confirmed 2026-11-17 that they allow showing their data, derived analytics and an API of derived analytics in this product, with a waitlist and possible paid tiers. Still no bulk redistribution of raw venue data.

**Still to check:**
- **New series:** exact tickers, categories, settlement sources and times for ETH, economics and financials on Kalshi and Polymarket, read from the APIs and each series' rules.

## Tech choices

Recommended defaults. Raise it with Carson before changing one.

- **Recorder: Go.** Stores raw venue messages in hourly gzip JSONL files (VM, archived nightly to the Hetzner Storage Box).
- **Python** for pricing, analytics and the strategy (Nautilus strategies are written in Python).
- **Postgres (Supabase)** for the live product data; tables in schema `manta`, read through a read-only login and the session pooler (the transaction pooler hangs on pipelined queries).
- **Parquet** (Nautilus's data catalog) for history; serving it for replay is decided at step 7 (likely DuckDB on a second small VM).
- **Next.js + TypeScript** for the site, deployed on Vercel.
- **Tests** for the pricing math and every analytics formula: known inputs with hand-checked outputs.

## Definition of done

- Recorder has run for at least four weeks with gaps logged, and the data-quality page shows it.
- Every tool in docs/product.md is live on the public site, each with its method explained in plain English.
- Fair values are tested and labelled by method; accuracy statistics are published with honest sample sizes.
- The waitlist is live, after the data-terms checks.
- The market maker's backtest report and paper-trading results show the profit-and-loss breakdown.
- README explains the project in plain English, credits NautilusTrader, states what worked and what did not, and includes the real numbers, including unflattering ones.

## Using NautilusTrader (Carson, 2026-11-12: "use it as much as you need; it is massive and we may not need all of it")

It's an installed dependency with a pinned exact version, never a fork or copied source.
- **Use:** the Parquet data catalog (history and replay), the backtest engine, fill simulation and strategy framework, and the Kalshi adapter for paper trading on Kalshi's demo environment.
- **Ours:** the recorder, the fair-value math and analytics, the raw→catalog converter, the strategy logic, the profit-and-loss breakdown, the product site.
- **Skip:** other venues, Rust extension points, distributed or Redis deployment.
- **Rule of thumb:** exchange connectivity and order-handling edge cases belong to Nautilus; the project's own ideas (pricing, analytics, strategy, measurement) are ours. Report adapter bugs upstream and work around them in our code.

## Layout

```
recorder/            Go: records Kalshi, Deribit, Coinbase, Kraken, Polymarket, Binance to raw hourly files; status, rawcat, normalize
pricing/             Python: fair-value model, live table (manta-fair), snapshotter for the site (manta-snap)
db/schema.sql        Postgres schema (schema `manta`)
site/                Next.js product site (Vercel)
backtest/            Python, NautilusTrader: recordings → catalog, fair values over recorded time, later the market maker
infra/deploy/        VM deploy, systemd units, nightly archive to the Storage Box
docs/                product spec, per-milestone plans, decisions.md (dated decisions)
```

Infra: the VM `series-1` (Hetzner CX23, Helsinki, <vm-ip>) runs the recorder and the snapshotter; recordings archive nightly to the Storage Box `manta-archive` (1 TB, <storagebox-user>); the site is the Vercel project `site` (team <vercel-team>, https://mantamarkets.com; domain registered at Namecheap 2026-11-21, DNS records there; www and mantamarkets.vercel.app redirect to it) on Supabase (us-east-2). Secrets live in `.env` (local), `/etc/manta/env` (VM) and Vercel's environment settings, never in git.
