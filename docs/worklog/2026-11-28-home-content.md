# Home page: tools and findings sections

## What
- Two sections added to the home page after Explore (site/app/(site)/page.tsx):
  - Tools: six terminal-style tiles, each drawn from live data and linking to its tool: Markets
    (7 busiest events), Order book, Cost to trade (buy and sell 100 / 1,000 / 10,000 on that
    book), Cross-venue (7 pairs after fees), Implied distribution, Official news (newest measured
    item and its biggest mover's chart). Replay, Alerts and API are links in the heading line.
  - From the recordings: four Insights answers as one number and one sentence, each linking to
    its anchor on /insights (accuracy, crossing, news, spreads).
- One commented CSS block at the end of globals.css (home-content).
- The page now runs: hero, preview, figures, Explore, Tools, From the recordings, API box, footer.

## Why
- Carson (2026-11-28): the home page "ends a bit abruptly". Real numbers and real screens instead
  of more copy, leading with the tools.

## Decisions
- Tiles reuse what the terminal preview already reads (events, pairs, distributions, news, the
  Kalshi book); the news chart is one more small file (~0.2 s). The findings add calibrationAll
  and getLiquidity (1.1–1.6 s each cold from a laptop, 10–80 ms warm). Both sections stream in
  their own Suspense below the fold: first byte 0.13 s cold, 6 ms warm on a local `next start`.
- No replay frame: one needs Kalshi lookups and several hourly files from the VM (seconds).
- The preview and the book and cost tiles share one pick: the most-traded Kalshi contract closing
  more than an hour out (at 10:45 ET a 15-minute Bitcoin market led and its book was empty). The
  tiles are left out without a two-sided book.
- Recorder coverage is not repeated in the findings: the figures row already shows it.
- A closing call-to-action band was built and removed: Carson did not want it.
- Explore stays as it is (it links How it's built and Insights).

## Checked
- typegen + tsc, lint, 73 tests, `next build`, `next start`: page serves, no React #419 (the only
  console error is Clerk refusing production keys on localhost). Findings match /insights.
- Phone (390): one tile per row, tables 354 px in 354 px tiles, no sideways scroll.
- The news tile with no measured item shows the newest item without a chart (simulated).

## Follow-ups
- Not checked on a Vercel preview; timings are from a laptop, not Vercel.
