# CLAUDE.md — Manta

This file briefs Claude Code on this project. Read it fully before doing anything.

## Status

This project **replaces Series** (earlier names: "event-terminal", "private-exchange"). Series is retired. Do not continue its roadmap: no private-company exchange, no custom Rust matching engine, no perpetual futures, no margin system, no guest trading.

Series failed on scope. It kept growing and nothing was ever demoable. The rule for this project is the opposite: **every milestone ends in something that runs and can be shown.**

Before writing new code, look through the existing repo for anything reusable from Series, especially Kalshi data ingestion, recording, and storage code. Report what you find and ask before deleting or rewriting it.

Project name: **Manta** (repo and package name: `manta-markets`, because another app already uses `Manta`). It pairs with Nautilus, the engine it is built on, and a manta feeds by steadily filtering many tiny things from the water, the way a market maker earns a fraction of a cent across many trades.

## What this project is

Two places let people bet on Bitcoin's future price:

- **Kalshi**: simple yes/no contracts, e.g. "Will Bitcoin be above $85,000 at 5pm?" A share costs 1 to 99 cents and pays $1 if yes. The price is the crowd's probability.
- **Deribit**: the largest crypto options exchange, used by professional trading firms. Its option prices imply a probability for the same question, and that estimate is usually better because the market is far bigger.

The two do not always agree. This project:

1. **Reads Deribit's option prices** and computes the fair value of every Kalshi Bitcoin contract in real time.
2. **Shows the comparison publicly**: a live site with Kalshi's price next to the options-implied price, and how the gap changes.
3. **Makes markets on Kalshi** around that fair value: offers to buy slightly below it and sell slightly above it, and manages its position.
4. **Runs live** with a small capped amount of real money on Kalshi, with published results.

Analogy: a shop that buys and sells used phones checks the big national marketplace to know what each phone is worth, then buys locally for a bit less and sells for a bit more. Deribit is the national marketplace, Kalshi is the local market, this program is the shop.

## Why it exists

A good outcome does not require profit. Professional firms quote these Kalshi markets nearly full time, so the bot may lose a little or break even. The deliverables are the pricing engine, the live tracker, and a clear explanation of where money was made and lost.

## How to work with Carson

- **Every part must be explainable.** Prefer simple, readable code over clever code. When you add a non-obvious piece (a formula, a model, a concurrency pattern), explain it in plain English in your reply and in a short comment.
- **Plain language.** Define any finance or math term the first time you use it. No unexplained jargon.
- **Small steps.** One milestone at a time. Do not build ahead.
- **Take a position.** When there is a design choice, recommend one option and say why. Do not list five options and stop.
- **No scope creep.** If an idea is not in the build order below, propose it and wait. Do not start it.
- **Say what you verified and what you did not.** Never report something as working unless you ran it.

## Built on NautilusTrader

The trading engine is [NautilusTrader](https://github.com/nautechsystems/nautilus_trader), used as an installed library. We do not write our own engine.

- **Use it openly and credit it.** The README must state the project is built on NautilusTrader.
- **Never copy Nautilus source into this repo as our own code.** It is LGPL-3.0. Import it, do not paste it.
- **What Nautilus provides:** connections to Kalshi, Deribit, and Polymarket; the event loop; order handling; backtesting.
- **What we write:** the pricing engine, the market-making strategy, the recorder setup, the analysis, and the website.
- If you find a bug or gap in a Nautilus adapter, tell Carson. A fix contributed upstream is valuable, but it goes through their contribution process, not a private patch.

## Build order

Do these in order. Each one must end demoable.

### 1. Recorder (start first, runs for weeks)
Record live data to disk, continuously:
- Kalshi: order books and trades for the Bitcoin contract series
- Deribit: Bitcoin option prices and the Bitcoin index price
- Polymarket: Bitcoin contract prices (read-only, added after the first two are stable)

Historical order-book data for Kalshi is hard to get later, so anything not recorded is lost. The recorder must restart on its own after a crash and log gaps.
**Demo:** a command that shows what has been recorded and for how long.

### 2. Pricing engine
Turn Deribit option prices into a fair probability for each Kalshi contract. Start with the daily "above/below" contracts. Start with the simplest sound method and improve it only when measurements show it is needed.
Two known hard parts, handle them explicitly:
- Deribit and Kalshi contracts expire at different times of day.
- Kalshi settles on an average of a benchmark index over the final 60 seconds, not on a single price.
**Demo:** a table of live Kalshi contracts with Kalshi price, our fair value, and the gap.

### 3. Live tracker site
A public page showing Kalshi price vs options-implied price per contract, the gap over time, and summary statistics (how often gaps appear, how large, at what times). Add Polymarket as a third line once recorded.
**Demo:** a deployed URL.

### 4. Market maker in backtest
A Nautilus strategy that quotes around fair value and shifts its quotes as it builds up a position. Replay it against recorded data. Report profit and loss split into: earned from the gap between buy and sell prices, lost to traders who knew more, and fees.
**Demo:** a backtest report generated by one command.

### 5. Demo environment, then live
Run on Kalshi's demo environment first. Go live only after Carson explicitly says so, under the money rules below.
**Demo:** a results page with real fills and the same profit-and-loss breakdown.

## Money and safety rules (non-negotiable)

- **No live trading without Carson's explicit go-ahead in the current session.** Default to demo or paper mode. Live mode must require a deliberate flag, never be the default.
- **Hard cap on live capital.** Default $200 total until Carson sets a different number. Enforce it in code with a kill switch that cancels all orders and stops the bot.
- **Kalshi only for live orders.** Deribit and Polymarket are read-only data sources. Never place an order on either.
- **No sports markets, ever.** Trade and record only Bitcoin and other financial contracts. Do not add sports series even for testing.
- **Secrets:** API keys live in environment variables or a local untracked file. Never commit them, never print them in logs.

## Facts to verify before relying on them

These were true as of November 11, 2026, from web research. Check each against the primary source before building on it. **Checked 2026-11-12** against the live APIs (docs/decisions.md):
- Kalshi KXBTCD and KXBTC are **hourly** (a new set every hour, e.g. closing 22:00 UTC); KXBTC15M is 15-minute. All three are category `Crypto` and settle on CF Benchmarks.
- All three have `fee_type: quadratic`, Kalshi's taker-only fee type (maker-fee series say `quadratic_with_maker_fees`), so **no maker fee today**. Re-check before going live.
- NautilusTrader 2.0.0rc9 is on PyPI as a pre-release; the latest stable is 1.231.0 (Python 3.12–3.14, LGPL-3.0). The Kalshi adapter's presence is confirmed only by installing it.
- Deribit: daily BTC options expire 08:00 UTC (4 dailies, then weeklies and monthlies; 902 live options on 2026-11-12). Public market data needs no account.
- The nearest Deribit expiry is up to 24 h away while KXBTCD contracts expire within hours, so **pricing must interpolate volatility down to a few hours**. That is the main modeling problem.
- The CF Benchmarks index (BRTI) is not a free feed. The recorder takes Coinbase and Kraken spot as a stand-in; measure the stand-in against Kalshi's published settlements before trusting it.

- **Nautilus Kalshi adapter:** shipped in NautilusTrader 2.0.0rc9 (released November 10, 2026) with market data, limit-order execution, and account reconciliation. Status is beta. It is a release candidate, so expect bugs. Confirm the installed version actually includes it.
- **Kalshi maker fees on Bitcoin series:** sources conflict. One reading of Kalshi's series API says KXBTC, KXBTCD, and KXBTC15M charge no maker fee. Another source lists crypto among maker-fee series. Call Kalshi's series endpoint and read the fee type directly.
- **Kalshi taker fee:** roughly 0.07 × contracts × price × (1 − price), rounded up, about 1.75 cents per contract at 50 cents. Confirm against the current fee schedule.
- **Kalshi settlement:** most crypto contracts settle on a CF Benchmarks index averaged over the 60 seconds before expiry. Read the rules of each series we trade.
- **Kalshi contract series:** hourly range (KXBTC), above/below (KXBTCD), 15-minute (KXBTC15M). Confirm tickers and expiry times from the API.
- **Deribit:** public market-data methods need no account. Daily options expire at 08:00 UTC, with up to four daily expiries listed for Bitcoin. Confirm from Deribit's docs.
- **Kalshi data display:** Kalshi previously gave Carson permission to display its data publicly (from the Series project). Ask Carson to confirm that permission covers this site before the tracker goes public.
- **Polymarket:** market data is readable without an account. US users cannot trade on the main exchange. Its Bitcoin contracts settle from different price sources and at different times than Kalshi's, so comparisons must adjust for that.

## Tech choices

Recommended defaults. Raise it with Carson before changing one.

- **Recorder: Go** (decision 2026-11-12). The raw recorder proven on Series, extended with Deribit and spot. It stores raw venue messages; Milestone 4 converts them into Nautilus's Parquet catalog.
- **Python** for the pricing engine and strategy (Nautilus strategies are written in Python).
- **Raw hourly files** (gzip JSONL on the VM, zstd on the Hetzner Storage Box) for recorded data, converted to Parquet with Nautilus's data catalog for backtests.
- **Postgres** for the tracker's summary data.
- **Next.js + TypeScript** for the tracker site, deployed on Vercel.
- **Tests** for the pricing math: known inputs with hand-checked outputs. Pricing bugs lose real money.

## Definition of done

- Recorder has run for at least four weeks with gaps logged.
- Pricing engine is tested and its fair values are published live.
- Tracker site is public and shows measured gap statistics.
- Backtest report and live results both show the profit-and-loss breakdown.
- README explains the project in plain English, credits NautilusTrader, states what worked and what did not, and includes the real numbers, including unflattering ones.

## Using NautilusTrader (Carson, 2026-11-12: "use it as much as you need; it is massive and we may not need all of it")

It's an installed dependency with a pinned exact version, never a fork or copied source.
- **Use:** the Deribit adapter and instruments (pricing), the Parquet data catalog, backtest engine, fill simulation and strategy framework (backtest), the Kalshi adapter for live orders and reconciliation, and the risk engine (live).
- **Ours:** the recorder, the fair-value math, the strategy logic, the raw→catalog converter, the profit-and-loss breakdown, the kill switch and money cap, the tracker site.
- **Skip:** other venues, Rust extension points, distributed or Redis deployment.
- **Rule of thumb:** exchange connectivity and order-handling edge cases belong to Nautilus; the project's own ideas (pricing, strategy, measurement) are ours. Report adapter bugs upstream and work around them in our code.

## Layout

```
recorder/            Go: records Kalshi, Deribit, Coinbase, Kraken to raw hourly files; `status` demo
infra/deploy/        VM deploy, systemd units, nightly archive to the Storage Box
docs/decisions.md    dated decisions
```

Infra: the VM `series-1` (Hetzner CX23, Helsinki, <vm-ip>) runs the recorder; recordings archive nightly to the Storage Box `manta-archive` (1 TB, <storagebox-user>). Secrets live in `.env` (local) and `/etc/manta/env` (VM), never in git.
