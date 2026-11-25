# 2026-11-25 — market page

## What
- `/m/<venue>/<event>` is the simple market page: the chance in big type with one plain line on what it means, the candle chart, the market brief, the order book and trades, the buy box and outcomes. The "+4.2 pts" pills on outcomes are gone; the fair-value card says in one line what fair value is and links to its accuracy.
- Order book (`BookSection`, both pages): side by side like a stock's depth-of-market. Bids on the left with size bars growing left, asks on the right growing right, best prices in the top row, one row per rank, the spread/mid/fair line above. Running totals hide on phones and in the contract page's narrow column. The terminal's BookPanel is unchanged.
- Market brief: 3-5 plain bullets from an AI summary of Manta's data on the contract, under the chart on `/m` and `/contract`, labelled "AI summary of Manta's data. Not investment advice." Pure prompt code in `lib/brief.ts` (tested), the call in `lib/brief-api.ts`.
- "Trade on Kalshi →" / "Trade on Polymarket →" on both pages, new tab, `rel="noopener noreferrer"`.
- Copy on both pages says which view is which: market page simple, contract page detailed, terminal the live workspace.

## Why
Carson (2026-11-25): the site reads as too technical for someone who trades on Polymarket. The market page is where a normal trader lands, so it leads with plain language; the contract page stays the detailed view.

## Decisions
- Brief: `claude-opus-5-5` (the API guide's recommended model), low effort, 2,000 max tokens, 20 s timeout, raw `fetch` (no new dependency), refusal fallback on. Cached 5 minutes per contract; a missing key or failed call returns nothing and the section is hidden (retried after a minute).
- The brief's input is only Manta's data: price moves from 1-minute candles (now, 1 h, 24 h, day range), best bid/ask and contracts within 5¢, 24 h volume, the last hour's buys and sells (span cut to the oldest trade when the 60-trade feed is full), fair value with method, the paired venue's quote and caveat, time to close. No user data.
- The prompt tells the model to describe, never to say buy/sell/hold or predict the outcome, and not to invent news.
- Venue links go to the event page: Kalshi redirects `/markets/<series>/<event>` to it (checked in a browser; Kalshi's site refuses curl). No per-contract deep link could be confirmed.
- The old `.book` styles were only used by BookSection and were replaced by `.dom`.

## Follow-ups
- The brief has not run against the real API: ANTHROPIC_API_KEY is not in this worktree's or the main checkout's `site/.env.local`. With a dummy key the call reached Anthropic (401) and the section hid. Needs one look on a preview deploy, where the key is set, to confirm the request is accepted and the bullets read well.
- Cost not measured; by list price about a cent per call, at most one per contract per 5 minutes per server instance.
- The Kalshi link format was checked on KXBTCD events only.
- The first commit (book + components) imports `lib/brief-api.ts`, added in the next commit; build the branch tip.
