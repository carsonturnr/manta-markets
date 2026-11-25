# Markets as one table, the header and footer, a simpler home (markets-home-nav)

## What
- /markets is one sortable table of contracts (lib/screener.ts `screen()`): market, price, spread, size at the best bid / ask, 24 h volume, gap to fair value, time to close. Category chips and a search are the only filters; each column heading shows a one-line explanation on hover or keyboard focus; rows open the Market page (/m/<venue>/<event>?o=<id>). 100 rows a page.
- lib/screener.ts: three new sort keys (`mid`, `depth`, `dollars`); existing sorts and filters unchanged.
- /screener's page now calls redirect() to /markets, carrying `category` (as `cat`) and `q`.
- Header: Markets · Insights · How it's built · Terminal, then Search and Sign in (Account in the signed-in menu). Arbitrage, Alerts, the Tools menu and the "Open terminal" button are gone; the phone Menu stays.
- Footer: two columns (the pages; Account and alerts, API, Privacy, Source code) and the credits; the giant wordmark is removed.
- Home: the hero and the live terminal demo as before, a new one-line pitch, five numbers (contracts quoted now, venues recorded, messages recorded, lowest coverage, the 93 ms live book delay) each with a one-line meaning, links to the four pages, and the API waitlist. Busiest markets, AI brief, arbitrage list and tools band removed.
- Removed lib/markets.ts and its test (only the old Markets page and home used them).

## Why
Finish plan (2026-11-25): six pages, Markets as one screener table, a home that shows the system rather than repeating other pages.

## Decisions
- No 24 h change column: manta.markets keeps only the current price, the tracker's history covers Bitcoin only, and predictions are taken relative to the close, not 24 h ago. Adding it needs a stored price history (recorder or database change), which is out of scope.
- "Depth near the top of the book" is the size at the best bid and ask, the only depth stored per contract; deeper levels are on the Market page.
- Default order is 24 h volume in dollars (Kalshi contracts × midpoint), so the two venues sort together; the column still shows each venue's own unit.
- 93 ms is a fixed figure, labelled with its measurement date (docs/decisions.md 2026-11-23); nothing measures it continuously.
- The API waitlist box stays on the home page (it is not a duplicate of another page).

## Redirects
- /screener → /markets (keep `q`; `category` becomes `cat`). The page redirects itself today; with next.config's redirect the page folder can be deleted.
- /compare (Arbitrage), /account as "Alerts": no longer in the header; /compare belongs to worktree I's Insights.

## Follow-ups
- globals.css still holds rules for removed pieces (`.pro-tools*`, `.tool-*`, `.foot-mark`, `.event-grid`, `.markets-home`, `.tools-band`, `.split-sec`, `.arb-home`); EventCard's default export is unused (its helpers are used by /m). Delete once the other worktrees merge.
- /insights and /how-its-built are linked but built in worktree I; they 404 until it merges.
- Sign in did not render on `next start` locally (Clerk's production keys); not changed here, not checked on a preview deploy.
