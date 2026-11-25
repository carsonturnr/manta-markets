# 2026-11-25 — research-pages

## What
- Bitcoin fair value (/tracker): each close is a card with one sentence (how many contracts have fair value above Kalshi's ask or below its bid, and the widest gap) over two ladders, "above" and "between": a row per strike with Kalshi's bid–ask as a grey bar and fair value as a mint tick, the gap shaded mint (fair above the ask) or red (below the bid). The table sits behind "Show the table". New components/FairLadder.tsx, helpers lib/tracker-view.ts (tested).
- Contract page (/c/<ticker>): one sentence on where fair value sits against Kalshi now; its chart tints the gap wherever fair value leaves the bid–ask band.
- Accuracy (/stats): the answer first, in words and three big numbers (Kalshi's Brier score, Manta's, closes scored) with a one-line definition of the Brier score; then one chart of every comparison as its 90% range around zero (left: Manta more accurate). Every table, the calibration chart (now beside its table) and the Kalshi Bitcoin detail sit behind a "Pro" disclosure. Helpers lib/stats-view.ts (tested).
- Data quality (/quality): one sentence (messages kept, lowest coverage, number of gaps, median and longest), then each venue's coverage with the time it missed as bars; the 7-day grid is grey with blips under a minute marked apart from gaps of a minute or more; tables below.
- Events (/events): one card per release with its biggest mover's chart and a line of figures; a release page leads with one sentence and puts the method behind a disclosure. Replay: one sentence on what it shows and why; how it is built behind a disclosure.
- globals.css: closed a `@media (max-width: 700px)` block the preview merge had left open (every later rule applied only on phones); fixed on the base too (9773eb4).

## Why
Carson: the research pages were bland tables, hard to picture; the accuracy page had lone left-column blocks between full-width rows, too much writing and unhelpful charts.

## Decisions
- Accuracy leads with crypto (fair value from Deribit's options, independent of the venue) at the horizon with the most closes; "more/less accurate" only when the whole 90% range is on one side of zero, else "about as accurate… a difference chance alone could produce". The chart shows each difference as a share of the venue's score, cut at ±50% so a 5-close range does not flatten the rest.
- Tracker ladders get their own scale per ladder (rounded up to 10¢): range contracts rarely pass 20¢.
- Quality bars show time missed, not coverage: every venue is above 99.4%, so coverage bars would all look full.
- No change to analytics math, queries, API, auth or routes; no new dependencies.

## Follow-ups
- /events and /replay could not be loaded live locally (replay server refuses this machine); events were checked against the fixtures in site/fixtures/events through a temporary, uncommitted loader. Replay was not seen rendered. Production /replay answered a server error on 2026-11-25 ~18:50 UTC to a headless browser: worth a look.
- The accuracy headline picks the horizon with most closes (5 min today); 1 hour may read better to a trader, Carson's call.
- On phones the tracker's range labels are cut with an ellipsis.
