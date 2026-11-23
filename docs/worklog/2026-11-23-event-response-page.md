# Event response: draft site pages (step 2, site half)

## What
- `replayserve`: two new routes, `GET /events` (release ids) and `GET /events/<release>.json`, from an `events/` folder next to the replay files, same token.
- `site/lib/events-response.ts`: reads releases from replayserve at request time; pure helpers (sort by |move|, "n/a" for null, seconds, book thinning, New York time) with tests in `events-response.test.ts`.
- `/events`: list of releases (name, UTC and ET time, contracts measured, "test run" badge for stand-ins).
- `/events/[release]`: one small step chart per contract that moved ≥ 1¢ (t0 marked in mint), a table (move, time to 90%, book within 2¢ 10 min → 30 s before, spread at t0 vs usual, book changes), the method with every term defined, the clock line, the Polymarket 10 s and small-sample caveats.
- `site/fixtures/events/`: two hand-made files (payrolls with a null-only Polymarket contract; a Bitcoin stand-in).
- `fetchReplay` moved to `lib/replayserve.ts` so the new lib doesn't pull in the database.

## Why
Step 2 of docs/plan-event-response.md: a draft page against the JSON the Go command (event-response-cmd worktree) will write, ready for Dec 4 payrolls.

## Decisions
- New `MoveChart` (plain server SVG, GapChart's style) rather than lightweight-charts: 45 minutes of steps with one marker line needs no client code, and the candle chart's props are candle-shaped.
- The default `"use cache"` profile (15 min) instead of `cacheLife`, so node's test runner can load the file; a release file changes rarely.
- List page fetches every release file: three in December. A summary endpoint can come later.
- Charted contracts: |move| ≥ 1¢ (Kalshi's tick); the table lists all of them.
- No nav or home-page link: carsonturnr/positioning changes the nav. Reachable by URL.

## Follow-ups
- Link /events from the nav once positioning is merged; terminal Catalysts panel link (plan).
- Run against a real JSON from event-response-cmd when it exists.
- `notFound()` inside Suspense streams a 200 with the 404 content, like the other dynamic pages.
- JSON format suggestions for Carson are in the report (not changed).
