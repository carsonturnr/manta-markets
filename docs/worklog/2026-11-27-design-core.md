# 2026-11-27 — design-core

## What
- Markets: one heading row over the list (Question · Outcome, price and the fair-value dot · Traded 24 h · Closes in); each row's repeated labels now reach screen readers only on wide screens. Rows are a little tighter.
- Markets on phones: the question on its own line, then outcome and price, 24 h volume and time to close on one line. Time to close was hidden on phones; the page went from 14,454 px to about 10,300 px tall.
- Market page, wide screens: order book and trades side by side under the chart (depth, ladder full width); 2,978 → 2,518 px tall at 1440.
- Market page, phones: outcomes right after the chart, then book, cost, trades, depth, fair value.
- Trades panel (terminal and Market page): large prints keep Buy/Sell in green/red; a grey wash and bold weight mark them instead of a green wash.
- Likely-range panel: legend and axis labels sit inside the panel's padding; line keys centred.
- Home: the four pages as four cells in one row on desktop (the old row left its middle column empty); the five figures two to a row on phones.

## Why
Carson asked for the three most-seen pages to look and work better. An audit at 1440 and 390 px found these the problems that most hurt scanning and the phone layout.

## Decisions
- CSS and one heading row only: no query, route, analytics or dependency changes; the approved look (black, mint, Newsreader/Geist) kept.
- Book beside trades via `grid-auto-flow: dense` on the main column, so the panels' source order (shared with the terminal) did not change.
- Phone order puts outcomes first after the chart, as the 2026-11-24 event page did before the panels were unified.
- No bid/ask strip in the Market page header: the list's prices lag the live book by up to a minute, and a strip that disagrees with the book below it would mislead.

## Follow-ups
- Proposed, not built: a live bid / ask / spread strip under the big chance figure (a small client component on the live feed).
- Proposed: a sticky filter bar on Markets for the long phone list.
- Unused CSS from earlier rounds (`.figures-row` base, `.band`, `.event-card`) is still there; one cleanup pass after the parallel worktrees merge.
- Signed-in header not checked (Clerk refuses localhost with production keys).
