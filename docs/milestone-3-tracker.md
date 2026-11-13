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

**What gets stored.** Only contracts "in play": Kalshi's mid or our fair value between 1¢ and 99¢, closing within 48 hours. 48, not 24: on Friday 2026-11-13 at 21:58 UTC no hourly event was open after the 22:00 close; the next was the following day's 22:00, 24 h 2 min away. That is about 15 to 60 contracts a minute (measured 2026-11-13: 16 to 31), roughly 20 MB a day at most; the 500 MB free tier holds the four-week run. The raw recordings (Milestone 1) keep everything else, including the weekly contracts. 
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
