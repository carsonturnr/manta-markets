# Milestone 4: market maker in backtest, plan

**Goal:** a NautilusTrader strategy that quotes Kalshi's Bitcoin contracts around our fair value and leans its quotes against its position, replayed against the recorded data, with profit and loss split into: earned from the spread, lost to better-informed traders ("adverse selection"), and fees.

**Demo:** one command that produces the backtest report.

## Steps (each runs before the next starts)

1. **Recorded data → Nautilus catalog.** *Demo:* a catalog of a day of KXBTCD order books that Nautilus replays, with the rebuilt top of book matching what we recorded.
2. **Fair value inside the backtest.** Deribit's recorded marks and index feed the Milestone 2 pricing, giving a fair value per contract as the replay runs.
3. **The strategy.** Quote a bid below and an ask above fair value; shift both away from the side we're already holding (inventory skew); cancel and step back near the close.
4. **Fill model and report.** How our resting orders get filled in replay, and the profit-and-loss breakdown.

## Step 1 design

```
raw hourly files ──▶ normalize (Go, recorder/cmd/normalize) ──▶ md.v1 JSONL ──▶ manta-catalog (Python) ──▶ Nautilus ParquetDataCatalog
                     the Series normalizer: YES/NO → one          books, trades,      BinaryOption instruments,
                     YES book, seq gaps, REST cross-checks        gap events          OrderBookDeltas, TradeTicks
```

- **Reuse the Series normalizer** (Go). It already turns Kalshi's two books (YES bids, NO bids) into one YES book, catches lost updates from sequence numbers, and cross-checks against Kalshi's REST snapshots. Measured on 2 hours (2026-11-13 21:00–23:00 UTC): 5.6 million updates applied with 0 mismatches, 9,184 REST comparisons with 0 mismatches, 99.93% of market-time verified.
- **Instruments built from our recordings.** Nautilus has no way to create Kalshi instruments offline, and Kalshi's API has no historical order books or quotes, so the recordings are the only source. Each market becomes a `BinaryOption` with the same ID the live adapter uses (`<ticker>.KALSHI`), so the strategy runs unchanged live.
- **Only what the strategy trades.** KXBTCD first; KXBTC and KXBTC15M later if the strategy extends to them.
- **Checked twice:** the rebuilt top of book is compared with the normalizer's book, and with the tracker's once-a-minute Kalshi bid/ask (taken independently from Kalshi's REST API).

## Facts this rests on (NautilusTrader 2.0.0rc9, checked 2026-11-13)

- Kalshi adapter present: data client, execution client, demo and production environments. Limit orders only; post-only supported (GTC/GTD).
- One market = one YES-priced `BinaryOption`, ID `<ticker>.KALSHI`; a NO position is a negative YES position. A NO bid at n is a YES ask at 1 − n.
- Sizes are fractional (0.01 contracts). The price grid comes from each market's `price_ranges` (sub-cent steps exist near 0 and 1).
- No historical books or quotes from Kalshi through the adapter.

## Step 1 results (2 hours, 2026-11-13 21:00–23:00 UTC, KXBTCD)

`manta-catalog` wrote 368 instruments, 3.1 million book deltas and 45,251 trades (56 MB) in 142 s; the normalizer reported 0 delta, REST and snapshot mismatches and 99.93% of market-time verified. `manta-catalog-check` rebuilt each book from the catalog and compared its best bid and ask with the tracker's 2,093 once-a-minute snapshots of the same contracts: 78% identical at the same moment, 100% within 60 seconds. The remaining timing differences are the tracker's source lagging: it reads Kalshi's market list, while the catalog matches Kalshi's order-book endpoint exactly (9,184 of 9,184 comparisons).

## Step 2 results (same 2 hours)

`manta-fair-series` replays the recorded Deribit messages into the Milestone 2 pricing: a running table of each option's implied volatility (`markprice.options` sends changes, plus a full table about every 5 minutes; nothing is priced before the first full table), forward prices from the recorded tickers of the two nearest expiries, and the index. Every 10 s of recorded time it prices every open KXBTCD contract: 170,280 fair values for 368 contracts in 58 s.

Checked against the tracker, which runs the same model on live REST data: over 2,195 matched values the difference is 0.05¢ at the median, 0.65¢ at the 90th percentile, and −0.05¢ on average (no bias). The tail (99th percentile 3.8¢) is in the last hour before a close, where fair value moves fastest with BTC, and comes from timing: the replay prices on a 10 s clock, the tracker at its own moment (index readings differ by a median $6). Kalshi's weekly contracts are out of scope: they need Deribit expiries beyond the two whose forwards are recorded.

## Known data notes

- At each close Kalshi sends an empty book snapshot (the book is cleared) without deletions for the old levels. Harmless: the market can't be traded after.
- A new recorder subscription (when the market list changes) restarts the book feed with fresh snapshots; markets left out had closed.
