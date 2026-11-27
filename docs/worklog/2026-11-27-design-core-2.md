# 2026-11-27 — design-core-2

## What
- Market page: a live quote strip under the big chance figure: best bid and ask with their sizes, the spread, and the last trade with its side, plus the feed's freshness. `QuoteStrip` in components/terminal/LivePanels.tsx, inside the page's existing `<Live>` (moved up to wrap the header).
- Markets on phones: the category, order and search filters stay pinned under the site header while the list scrolls, in a tighter form.

## Why
Carson approved both proposals from the design-core round (2026-11-27).

## Decisions
- The strip reads the live book, not the market list: the list lags the book by up to a minute, and a strip that disagreed with the book below it would mislead.
- Pinned on phones only: on a desktop the filters sit beside each other in one short row near the top.

## Follow-ups
- Not seen in a browser: the shared Supabase session pool was full of production's connections (15 of 15) while this was built, and a local server would compete for the same slots. Typecheck, lint, tests and `next build` pass; check on the Vercel preview before merging.
- Production showed "This page didn't load" for about 20 minutes after #21 deployed ("max clients reached in session mode") and recovered by itself. Raising the pool size in Supabase's dashboard (the 2026-11-26 follow-up) is the fix.
