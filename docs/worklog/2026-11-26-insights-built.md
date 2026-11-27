# 2026-11-26 insights-built

## What
- New /insights: four questions, each one sentence and one chart: when spreads are tightest (hour-of-day heat map), how accurate market prices are (calibration chart with closes and contracts counted; fair value vs the market in one line), what crossing between venues costs after fees (pairs crossing before vs after fees, a bar per crossing split into fees and what is left), how the book behaves around a release (newest release, the stand-in labelled "test run" until payrolls on Dec 4).
- The old pages' tables and detail moved under each answer's "More"; release detail pages moved to /insights/releases/<id>.
- New /how-its-built: architecture diagram in HTML/CSS (venues → Go recorder → archive / pricing → Postgres → site / live relay → terminal), six numbers with their dates, the data-quality view moved from /quality, links to the repo and decisions log.
- lib/stats-view.ts: new `calibrationMiss` (contract-weighted distance from the diagonal), with a test. No existing function changed.

## Why
Finish brief: six pages, rough data summarised into answers a trader can act on, and a page that explains the system.

## Decisions
- Moved the old page code (git mv) rather than rewriting it: same queries, same math, less to review.
- Cut from /liquidity: the "cheapest now" and "thin now" cards and the every-market table (the heat map and spread-now bars cover them).
- Crossing is a one-minute snapshot: a history needs a new table (a migration), so not done; the page says so.
- Diagram as HTML boxes, not SVG: SVG text shrinks to unreadable on a 390 px phone.
- The release section catches a replay-server failure so the rest of Insights still loads.

## Redirects
- /liquidity → /insights#spreads
- /stats → /insights#accuracy
- /compare → /insights#crossing
- /events → /insights#release
- /events/:release → /insights/releases/:release
- /quality → /how-its-built#quality
(Each old page.tsx calls redirect() itself until next.config has these.)

## Follow-ups
- Links to the old URLs remain in files other worktrees own: app/(site)/layout.tsx, components/NavLinks.tsx, app/(site)/page.tsx, app/(site)/markets/page.tsx (H); app/terminal/page.tsx, components/terminal/Panels.tsx, app/(site)/tracker/page.tsx, app/(site)/m/[venue]/[event]/page.tsx (G); app/(site)/docs/api/page.tsx. Insights links to /screener?family=… (H's redirect target).
- Not seen with live release data: locally REPLAY_URL is http:// against the TLS replay server (400); checked with the repo's fixture through a local stand-in server.
- The numbers tiles' fixed values (93 ms, 185 tests) need updating by hand if re-measured.
