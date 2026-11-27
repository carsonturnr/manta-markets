# 2026-11-25 — account-analytics

## What
- Signed-out /account: an animated text-art manta fills the left half of the page (the mark from components/Mark.tsx gliding over rippling characters, mint on greys, Geist Mono, drawn on a canvas). On the right: a heading, four plain lines (watchlist, price/spread/depth alerts, cross-venue gap alerts, API keys) and Clerk's sign-in form. The pills are gone.
- Distributions: "Volatility by horizon" removed. The featured ladder leads with one sentence of what the market expects ("The market sees Bitcoin's price most likely landing between $59,187 and $60,080 at Nov 25, 22:00 UTC (a 50% chance); middle estimate $59,625."), then the chart. Below: one card per market (its next ladder to close), each with the sentence and a chart. The full table sits behind "Show every ladder".
- Liquidity: one-line definitions of spread and depth; three answers (cheapest to trade now, best time of day, thin right now); bars of each market's spread now, narrowest first, with depth; an hour-of-day chart showing how much narrower or wider than usual spreads are at each hour. The old table and heat map sit behind a "Pro" disclosure.
- New pure helpers with tests: `expects()` in lib/units.ts, `hourProfile()` and `isThin()` in lib/liquidity-view.ts.

## Why
Carson: the account page's pills looked bad and its art was small and static; the volatility charts were mostly empty dots; the liquidity table and grey heat map didn't help a normal trader. Direction of 2026-11-25: a plain-language layer first, the technical detail one level deeper.

## Decisions
- Canvas, not a `<pre>`: the mark and the field need different colours per character. 12 frames a second, paused when the tab is hidden or the art is off screen; one still frame under reduced motion. No new dependency.
- The art fills the left half of the page between the dashed rails, not the browser edge, so the page frame stays intact.
- "Most likely between" is the middle 50% (25th to 75th percentile), and the sentence says "(a 50% chance)" so it is never read as a sure range.
- Distribution cards: the soonest ladder per market, not every ladder (46 today): every ladder stays one click away in the table, and any row can be featured at the top.
- Thin market: a median spread of 5¢ or more (the same line as Distributions) or fewer than 20 contracts at the best prices.
- Best hours: each market's hourly spread compared with its own typical hour, then averaged, so a 40¢ market doesn't drown the 1¢ ones. On 8.9 days of samples: narrowest around 18:00 UTC (about 16% below typical), widest around 12:00 UTC (about 10% above).
- Spread bars are drawn to 10¢; the one wider market (Fed funds rate, 42¢) gets an arrow so it doesn't flatten the rest.
- No analytics math, query, API, auth or route changes.

## Follow-ups
- components/TermChart.tsx is now unused; waiting for Carson's OK to delete it.
- DistChart's legend now says "Likely range" and "Middle estimate"; the terminal's distribution panel shares that wording.
- Signed-in /account not checked (Clerk refuses localhost with production keys).
- The "Pro" label is a disclosure only; it isn't tied to a plan or a sign-in.
