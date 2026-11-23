# Plan: event response (proposed 2026-11-23, Carson: "go")

**Demo:** a page listing each economic release we recorded (payrolls, CPI, Fed decision); open one
and see, for every contract still trading at that moment, how far its price moved, how fast, and
what happened to its order book just before. All derived from our own recordings.

## Words used here

- **Release time (t0):** the official minute a number is published: 13:30 UTC (8:30 ET) for
  payrolls, unemployment and CPI; 19:00 UTC (2 pm ET) for the Fed's decision (an hour earlier in
  US summer time). Taken from the published BLS and Fed calendars and checked against Kalshi's
  close times, which sit one minute before (KXPAYROLLS-26NOV closes 2026-12-04 13:29 UTC).
- **Move:** a contract's midpoint (halfway between best bid and best ask) 30 minutes after t0,
  minus its midpoint just before t0, in cents.
- **Time to 90%:** seconds from t0 until the midpoint first gets 90% of the way to where it ends
  up at t0 + 30 min (and stays past that point for 10 s, so one stray quote doesn't count).
- **Book thinning:** contracts resting within 2¢ of the mid, 10 minutes before t0 against
  30 seconds before. Market makers pull quotes before news; this shows by how much.
- **Spread at t0:** best ask minus best bid at the moment of release, against its usual value.

## The finding that shapes the design

A release's own contracts close *before* it (payrolls at 13:29 for a 13:30 number), so they
never show the reaction. The reaction is in contracts still trading:
- the next Fed meetings (Kalshi KXFEDDECISION and KXFED, Polymarket fed-decision): payrolls and
  CPI change rate expectations;
- later months' CPI and payrolls ladders;
- S&P 500 and Nasdaq-100 hourly contracts (KXINXU, KXNASDAQ100U), EUR/USD and USD/JPY hourly,
  Bitcoin and Ether hourly;
- for reference, Deribit's Bitcoin index and Coinbase spot (recorded as streams).

## What we have, measured

- Economics series recorded since 2026-11-16 01:50 UTC. No release has happened since then
  (no economics contract has settled in manta.predictions). First releases in our data:
  **Dec 4** payrolls and unemployment, **Dec 9** Fed decision, **Dec 10** CPI. So the first
  real demo is Dec 4, and December gives three releases: small samples, said so on the page.
- Kalshi arrives as a WebSocket stream: per-message timing is fine. **Polymarket is polled every
  10 s**, so its time-to-90% can only be given to the nearest 10 s; the page will say so.

## How (reusing what exists)

1. **Clock check first.** Times are our VM's receive times. Measure the VM's clock offset
   (`chronyc tracking`) and compare Kalshi's own message timestamps, where present, with our
   receive times. Publish the offset on the page. If it is over ~100 ms, fix
   before trusting sub-second numbers.
2. **Computation on the VM**, a new Go command `recorder/cmd/eventresponse`, reusing
   `internal/replay`'s order-book rebuild: read the hourly files covering t0 − 15 min to
   t0 + 30 min, keep each listed contract's book, write one JSON file per release next to the
   replay files. `replayserve` already serves that folder to the site with a token: **no new
   service, no database migration.** Run from the existing hourly replay timer when a release's
   window has ended. Its CPU cost is measured before deploying (replay takes ~14 min/hour today).
3. **Formulas in pure functions with tests** (`internal/eventresponse`): hand-made books with a
   known move and timing (mid 40¢ → 46¢, 90% reached at +2.4 s) → exact expected outputs.
4. **Site:** `/events` lists releases; `/events/[release]` shows a chart of each reacting
   contract's mid from −15 to +30 min with t0 marked, and a table (move, time to 90%, book
   thinning, spread at t0), each figure with its sample size. Read through `lib/events-response.ts`
   like `lib/replay.ts`. The terminal's Catalysts panel links a past release to its page.

## Steps, each demoable

1. Clock check and the formulas with tests. Demo: tests, and the measured clock offset.
2. The command run locally on one recorded hour with a big move (a Bitcoin hourly close stands
   in until Dec 4). Demo: its JSON and a draft page against it.
3. Deploy to the VM (needs Carson's go-ahead), first real run on Dec 4 13:30 UTC. Demo: the
   payrolls page with real numbers.

## Step 2 of the idea: news (research only, no code)

Unscheduled events need a news source. Before adding one, compare 2–3 candidates on: cost,
delay from publication to our receipt (measured, not advertised), what their terms let us show
(headline text, or only "an event at 14:05:09"), and how they timestamp. Official sources
(BLS, BEA, Fed press releases and its speech calendar) come first: free, exact and what moves
these contracts. Then one or two paid real-time wires. Result: a one-page comparison for Carson;
any paid feed or new dependency waits for his approval.

## Not in this plan

General headlines on the chart, "moves with no event" detection (after news is in), any trading
signal. The page measures reactions; it doesn't say what to trade.
