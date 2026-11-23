# Manta

A terminal for prediction markets. Manta covers the crypto, economics and financial contracts on
Kalshi and Polymarket (never sports) and gives you the tools to work with them: a screener, live
order books and trades, the same question compared across venues, what a trade really costs after
fees, implied distributions, history and replay, and alerts. Live at https://mantamarkets.com.

**Built on [NautilusTrader](https://github.com/nautechsystems/nautilus_trader)** (LGPL-3.0), used
as an installed library for the history catalog and backtesting. Manta's own code is the recorder,
the pricing and analytics, the site and the measurement.

## What it does

- **Terminal** (`/terminal`): market monitor, chart, order book and depth, trade tape and a trade
  ticket in preset layouts, with a ⌘K command bar.
- **Screener and event pages** (`/screener`, `/m/<venue>/<event>`): every covered contract,
  filterable; each event with its order books, candles, trades and plain-English settlement rules.
- **Compare** (`/compare`): the same question on Kalshi and Polymarket side by side, and where the
  prices cross after both venues' fees.
- **Cost to trade** (on contract pages): the average price, slippage and fee of buying or selling
  N contracts, walked through the live book. **Liquidity** (`/liquidity`): depth and spreads over
  time.
- **Distributions** (`/distributions`): each ladder of strikes read as the market's probability
  distribution and term structure.
- **Fair value**: a price per contract from Deribit's options (Bitcoin, Ether) or the venues' own
  books, always labelled with its method; its track record is on the accuracy page (`/stats`).
- **Replay** (`/replay`): past closes minute by minute, from Manta's own recordings (Kalshi does
  not publish historical order books).
- **Data quality** (`/quality`): what the recorder captured, per venue, and every gap.
- **Accounts**: watchlists and email alerts.

## How it's built

```
venues (Kalshi, Polymarket, Deribit, Coinbase, Kraken, Binance)
   │  WebSocket / REST, read-only
   ▼
recorder (Go, on a VM) ──► raw hourly gzip JSONL ──► nightly archive (Storage Box)
   │                              │
   │ relay / replay servers       └─► backtest/ (Python + NautilusTrader Parquet catalog)
   ▼
pricing jobs (Python, every minute) ──► Postgres (Supabase, schema `manta`)
                                              │  read-only login
                                              ▼
                                   site (Next.js 16, React 19, TypeScript, Vercel)
```

| Folder | What | Stack |
|---|---|---|
| `recorder/` | records raw venue messages; status, replay, relay and normalizer tools | Go |
| `pricing/` | fair values, distributions, liquidity, accuracy, alerts | Python 3.13, uv |
| `backtest/` | recordings → NautilusTrader catalog | Python 3.13, NautilusTrader |
| `site/` | the product site | Next.js, Clerk sign-in, Postgres |
| `db/` | Postgres schema | SQL |
| `infra/deploy/` | VM deploy scripts and systemd units | bash, systemd |
| `docs/` | product spec, design notes per milestone, dated decisions | |

## Run it locally

None of the steps below need an account or a secret.

```
# Tests
cd pricing  && uv run pytest -q
cd recorder && go test ./...
cd site     && npm ci && npm test

# Record live data into ./data/raw (Kalshi through its public REST API when no key is set)
cd recorder && go run ./cmd/recorder -out ../data/raw
go run ./cmd/status -in ../data/raw          # what was recorded, and every gap

# Price Kalshi's Bitcoin contracts from Deribit's options, in the terminal
cd pricing && uv run manta-fair
```

The site reads Postgres. With a local Postgres (any Postgres 15+):

```
createdb manta
cp .env.example .env                 # DATABASE_URL=postgresql://localhost:5432/manta
cd pricing && uv run --env-file ../.env manta-snap --init                  # tables and logins
cd ../recorder && go run ./cmd/contracts -out ../data/contracts.json      # today's listing
cd ../pricing && uv run --env-file ../.env manta-contracts ../data/contracts.json   # fill it
cd ../site && cp .env.example .env.local && npm run dev                    # http://localhost:3000
```

Sign-in, the waitlist, replay and alerts need their own services (Clerk, Resend, the replay
server); `.env.example` and `site/.env.example` list each setting.

## Docs

- [docs/product.md](docs/product.md): the product spec.
- [docs/decisions.md](docs/decisions.md): every decision, dated, with what was measured.
- `docs/milestone-*.md`: design notes for the recorder, pricing, tracker and backtest.

## License

MIT (see [LICENSE](LICENSE)). NautilusTrader, a dependency, is LGPL-3.0 and is used as an installed library, not copied.
