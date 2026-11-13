# Milestone 3: live tracker, plan

**Goal:** a public page that shows, for each live Kalshi Bitcoin contract, Kalshi's price next to the options-implied fair value, how the gap changes over time, and measured statistics about the gaps.

**Demo:** a deployed URL.

## Pieces

```
VM series-1                          Supabase (Postgres, Frankfurt)        Vercel
manta-snap (every minute)  ──────▶   runs, contracts, quotes        ◀──── Next.js site (read-only role)
  Deribit index + option vols
  Kalshi KXBTCD / KXBTC prices
  our fair value (Milestone 2 math)
  settled results, after each close
```

1. **Snapshotter (`manta-snap`, Python, in `pricing/`).** Once a minute (a systemd timer on the VM): fetch Deribit's index and option volatilities and Kalshi's open KXBTCD and KXBTC markets over public REST, price every contract with the Milestone 2 code, and write the rows. It also fills in each contract's result once Kalshi settles it. Each run is independent: a failed minute is a missing row, never a stuck process.
2. **Database (Supabase free tier, used as plain Postgres).** Schema in `db/schema.sql`. The site connects with a read-only role, so a bug or leak on the site can't change data.
3. **Site (`site/`, Next.js + TypeScript on Vercel).** Server-rendered pages that query Postgres directly; no API layer of our own.

## Tables

- `runs`: one row per minute: time, Deribit BTC index, Coinbase BTC/USD, and how many contracts were priced. Coinbase is one of the recorder's stand-ins for the BRTI index Kalshi settles on.
- `contracts`: one row per Kalshi contract: ticker, series, strike(s), close time, and once settled, Kalshi's result (yes/no) and settlement value (the 60-second BRTI average it settled on).
- `quotes`: one row per contract per minute: Kalshi yes bid and ask, our fair value, and the volatility used.

**What gets stored.** Only contracts "in play": Kalshi's mid or our fair value between 3¢ and 97¢, closing within 48 hours, and once every 5 minutes (not every minute) while the close is more than 6 hours away. 48 hours, not 24: hourly events are listed only about an hour ahead, so a 24-hour window can leave the board nearly empty. Measured 2026-11-13: the first version (1–99¢, every minute) wrote 116 rows a minute at about 200 bytes each, 34 MB a day, nearly twice the 500 MB free tier over four weeks; with these rules about 37 rows a minute, roughly 300 MB for four weeks. The raw recordings (Milestone 1) keep everything else.
## What the site shows

1. **Now:** the next closes, each contract with Kalshi bid/ask, our fair value and the gap (fair − Kalshi mid), flagged when fair is outside the bid–ask.
2. **One contract:** Kalshi bid/ask band and our fair value, minute by minute until the close, and how it settled.
3. **Gap statistics:** how often fair sits outside Kalshi's bid–ask, how far, by time to close and by hour of day.
4. **Who was right (calibration).** For settled contracts: group predictions by price (e.g. all the times a contract was priced 20–30¢) and compare with how often they actually paid out. Done for Kalshi's mid and for our fair value, with the Brier score (the average squared error between the probability and the 0/1 outcome; lower is better). This is the measurement that decides the open question from Milestone 2: is our distribution too narrow, or is Kalshi overpricing big moves?
5. **Index basis.** Kalshi's settlement value against the Deribit index and Coinbase at the close: how far the stand-ins sit from the BRTI.

Statistics need settled data, so pages 3–5 fill in as the weeks go by; they say how many contracts they're based on.

## Order (each step runs before the next starts)

1. Schema, and `manta-snap` run by hand against Supabase. *Demo:* rows in the tables.
2. `manta-snap` on the VM every minute. *Demo:* row counts growing; `manta-snap --status`.
3. Site locally: pages 1 and 2.
4. Deploy to Vercel (walked through with Carson, who approves the GitHub access). *Demo:* the URL.
5. Pages 3–5, once there are settled contracts to measure.
6. Polymarket as a third line, after it's recorded (Milestone 1's last item).

## Choices, with reasons

- **REST every minute, not Nautilus's Deribit adapter.** The Milestone 2 entry said the adapter would come in here. A one-minute snapshot doesn't need a streaming engine; three REST calls a minute are simpler to run and to explain. Nautilus enters with the backtest (Milestone 4), where its data catalog and event loop are the point.
- **A timer, not a long-running loop.** Each minute starts fresh, so there's no state to corrupt and no reconnect logic.
- **A separate deploy script.** The recorder's deploy restarts the recorder, so the snapshotter has its own; updating it never interrupts recording.

## Out of scope here

KXBTC15M, fees, Polymarket (until recorded), changes to the pricing model (Milestone 3 measures; changes come after, from the numbers).
