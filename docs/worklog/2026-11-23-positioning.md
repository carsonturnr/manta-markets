# 2026-11-23 — positioning

## What
- Home is the terminal's front door: "A terminal for prediction markets", button to /terminal; live figures; a "The tools" band (terminal, screener, compare, liquidity and cost, distributions, replay, alerts, fair value last), each with one live figure; busiest markets; widest cross-venue gaps with crossings after fees; what the ladders imply; API waitlist.
- Removed from home: the Market-vs-Manta hero chart, "Where Manta disagrees most" and the "Manta disagrees" filter. Market cards no longer carry red/green gap chips.
- Header nav is tools only: Markets, Compare, Liquidity, Distributions, Replay (+ Open terminal). "Forecasts" and "Track record" are gone; the footer groups Tools, Analytics, Research (fair-value accuracy, data quality), Account. The terminal's header links match.
- Fair value is labelled "Fair value"/"Fair" with its method everywhere (screener column, event page, terminal panels); the event page shows it after the order book, trades and rules, with no "looks cheap/pricey" call; the cost box no longer says whether a trade is "worth more than it costs".
- Accuracy page retitled "Fair-value accuracy" and framed as research; "Who was right" and "How often the two markets disagree" headings replaced.
- Metadata: site title "Manta: a terminal for prediction markets", description lists the tools; liquidity and accuracy titles updated.

## Why
Carson has said since 2026-11-15 (docs/decisions.md) that Manta is a tools / trading-terminal product. The 2026-11-22 redesign made fair-value disagreement the pitch (hero, band, filter, verdicts). This puts the tools first again across the site.

## Decisions
- Reworked the homepage's structure, not just copy: copy alone left the Market-vs-Manta chart and the "disagrees" band as the page's two biggest elements.
- Reused the existing band/ranked and split-sec styles and the queries the tools already run (events, pairs, distributions, liquidity, quality): no new components, queries or dependencies; analytics math untouched.
- Nav label for /liquidity is "Liquidity" (not "Cost to trade"): the per-trade calculator lives on contract pages; the page title says both.
- Kept the fair-value gap column/chips on the screener, event ladder and terminal: one labelled column, as the rule allows.

## Follow-ups
- components/HeroChart.tsx and its CSS (hero-card, callouts, dumbbell, db-*) are now unused; delete with Carson's OK.
- /replay once rendered an error boundary under Kalshi HTTP 429s from its market fetches (first request after `next start`); not caused by this change.
- lib/outcomes.ts still names its result "cheap"/"pricey" internally; no user-facing text uses it now.
- Site checks are still not in CI.
