# Manta

An analytics terminal for prediction markets: a screener, live order books, cross-venue comparison, fair values, implied distributions, and a cost-to-trade calculator for Kalshi and Polymarket's crypto, economics and financial contracts (never sports). A market maker on Kalshi is built on top, paper traded. Live: https://mantamarkets.com. Product spec: [docs/product.md](docs/product.md).

**Uses [NautilusTrader](https://github.com/nautechsystems/nautilus_trader)** (LGPL-3.0), as an installed library, for the history catalog, backtesting and paper trading. Manta's own code is the recorder, the pricing and analytics, the site, the strategy and the measurement.

## Milestone 1: recorder

Records, continuously:
- **Kalshi:** order books and trades for the Bitcoin series KXBTCD (above/below), KXBTC (ranges) and KXBTC15M (15 minutes).
- **Deribit:** the BTC index, the mark price and implied volatility of every BTC option, and full quotes for near-expiry, near-the-money options.
- **Coinbase and Kraken:** BTC/USD spot, a stand-in for the CF Benchmarks index Kalshi settles on.
- **Polymarket:** order books of the daily "Bitcoin above ___" and "Bitcoin price on" contracts, every 10 seconds (read-only).
- **Binance:** BTC/USDT 1-minute candles and ticker, the price Polymarket settles on.

```
cd recorder
go run ./cmd/recorder -out ../data/raw     # record (KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PATH for the WebSocket)
go run ./cmd/status -in ../data/raw        # what has been recorded, for how long, and every gap
```

## Milestone 2: pricing

Fair value for each Kalshi contract from Deribit's option prices. The method, in plain English, is in [docs/milestone-2-pricing.md](docs/milestone-2-pricing.md).

```
cd pricing
uv run manta-fair          # live table: Kalshi bid/ask, our fair value, the gap
uv run pytest              # hand-checked tests of the math
```

## Milestone 3: live tracker (in progress)

Once a minute, the VM prices every in-play Kalshi contract and writes Kalshi's bid/ask and our fair value to Postgres (Supabase); a Next.js site shows them side by side with the gap over time. Plan and choices: [docs/milestone-3-tracker.md](docs/milestone-3-tracker.md).

```
cd pricing
uv run --env-file ../.env manta-snap --status   # what the tracker database holds
cd ../site
npm run dev                                      # the site (needs site/.env.local)
```
