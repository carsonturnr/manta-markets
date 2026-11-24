# 2026-11-24 — site design

## What
- Phone header: links, search, sign-in and "Open terminal" fold behind a Menu button (one small client component, `components/HeaderMenu.tsx`); the home page no longer scrolls sideways on a phone.
- Error and not-found pages inside the site's header and footer (`app/(site)/error.tsx`, `not-found.tsx`, `app/not-found.tsx`), with "Try again".
- Faint grey text (`--text-3`) raised from #6b6b6b (3.9:1) to #7a7a7a (4.8:1).
- Screener: the table scrolls with the page; on wide screens its headings stick under the site header.
- Event page: 6 book levels each side with a "Full book" link to the contract page; on phones the buy box and outcomes come right after the chart.
- Contract page: two stacked columns (chart, cost, pricing notes | book, trades, alerts), so short panels leave no empty space.
- Liquidity heat map in grey, brighter for wider spreads (was bright mint for the widest).
- Compare: jump links to each event; a note every pair in an event shares is shown once under its heading.
- Terminal on phones: the site links row is hidden and the focus line wraps.
- Signed-out /account: the mark as ASCII art beside perk pills and Clerk's sign-in form in place.
- Round 2 (Carson's review): selects get our chevron and a styled open list; chart hover card (OHLC, change, volume, bid/ask, fair) and TradingView logo off; event page keeps book and trades tabs, rules move to fine print opening "From Kalshi:"; tools band no longer green; Compare leads with arbitrage after fees (legs, size, dollars) and folds every pair by event; Distributions is one panel with a figure strip over the chart.

## Why
An audit at 1440 and 390 px wide found these the most visible problems for a product meant to look like a serious trading terminal; Carson asked for all of them.

## Decisions
- TradingView logo off: the library's licence asks for a link to tradingview.com on each page using it, which the footer and the terminal's status bar now carry.
- Compare's arbitrage cards show each pair's kind and caveat ("Near: different index"), so a near-equivalent pair is never presented as risk-free.
- Kept the approved look (black, mint, Newsreader/Geist): layout, CSS and copy only; no new dependencies, no query, math, auth, API or route changes.
- The phone menu is a client component rather than `<details>`: closed `<details>` hides its content on desktop too, and the fix for that (`::details-content`) is too new for older Safari.
- Contract page uses two flex columns, not grid rows: rows share heights, so a short calculator next to a tall trades list left a gap.
- The event page book is cut, not hidden behind a toggle: the contract page already has the full book.

## Follow-ups
- Awaiting Carson's direction: home hero visual, footer rework, liquidity/tracker/accuracy visuals, AI insights, terminal resizing and chart drawing, links out to the venues.
- Signed-in pages (account with data, alerts) not checked; Clerk refuses localhost with production keys.
- /replay fails locally (replay server answers 400 to this machine); the new error page shows instead.
- Compare's bundle rows still list every Polymarket bucket; long rows remain on CPI events.
- Unused HeroChart and its CSS still await Carson's OK to delete (2026-11-23).
