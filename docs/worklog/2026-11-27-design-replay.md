# 2026-11-27 — design-replay

## What
- /replay loads in about 3 s cold instead of about 24 s: close times are looked up on Kalshi only for the family on screen, and the replay index is read once per render (local `next start`, empty cache: /replay 3.4 s, S&P 3.0 s, CPI 0.6 s, an unknown family 0.02 s; production before: 21.7–25.2 s on every request).
- The page no longer sends every trade to the browser, only the contracts traded per minute: Bitcoin went from 1.1 MB to 140 KB of HTML.
- New player: one contract's bid–ask over the whole close (fair value dotted and labelled "fair" for Bitcoin), a time cursor, the current numbers above it, and at the last minute a Yes/No dot in the same colours as the ladder.
- Beside it (below it on phones) a ladder of strikes at the cursor minute: bid, ask, a midpoint bar and the result at the last minute. A click charts that strike. It shows 13 strikes around the one nearest 50¢, so an 80-strike S&P close stays short.
- Two empty states: "There's no replay for BOGUS." with the family links, and "No CPI, monthly close recorded yet." for a family with nothing finished.
- Intro cut to one line; Other closes shows the latest 12, the rest under "All N".

## Why
Carson: "massive graph with like 8 disconnected lines on it. no data or anything." The old chart put strikes on the x-axis, which left six bars and dots and showed nothing over time. The page also took 18–25 s.

## Decisions
- Root cause of the slowness: `"use cache"` is in-memory and on Vercel rarely survives to the next request (Next 16 use-cache.md), so every request redid ~94 Kalshi lookups across all 22 recorded series, paced 5 per half second. A per-family lookup was enough; `use cache: remote` would cost platform fees.
- Family links come from the replay index (recorded, finished or not). Resolving every family's close would bring the slow path back; a family with nothing finished gets its own empty state.
- Kalshi drawn in ink and fair value in mint, as on the rest of the site. Yes/No use `--up`/`--down`.
- The ladder centres on two-sided books when there are any: in the last minutes a lone 89¢ ask reads as a 45¢ midpoint.

## Follow-ups
- Not seen locally: the fair line and Bitcoin's price. site/.env.local still points at Supabase, which stopped updating on 2026-11-27, so those tables have no rows for recent closes. Check them on the preview.
- `use cache: remote` for the Kalshi close lookups if a cold family load (~2–3 s) is still too slow.
- The S&P page is still 870 KB: 80 strikes × 360 minutes of quotes.
