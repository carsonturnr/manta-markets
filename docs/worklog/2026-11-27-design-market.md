# design-market: Market page, Markets list, terminal and home preview polish

## What
- Market page: the price is now the quote strip's first, larger cell ("Chance of X" over "94%"), on the same baseline as bid, ask, spread and last trade; the buttons sit beside the close time.
- Cut explanatory text: the Markets lede paragraph and the count line under the filters, the Market page's "midpoint between…" line, and the chart's "drag to pan" hint. Data labels, source credits and "Not investment advice" stay.
- Venue logos replace the "■ Kalshi" dots and the white K/P squares (components/VenueLogo.tsx, site/public/venues/).
- Charts open as a line everywhere (Market page, terminal, home preview). Candles stay one click away, and only when at least 20 bars moved (`enoughCandles`, with a test).
- Phones: the Market page's header is compressed (smaller title, 4-column quote strip, chart toolbar on one scrolling row), so the chart shows on the first screen. The home preview becomes one static card (question, venue, outcome, large mid and fair value, line chart, "Open the full terminal").
- Terminal Cross-venue layout: the arb panel is 540 px by default (was 1.4fr, ~650 px at 1440), and the chart gets the rest.

## Why
Carson's design review of 2026-11-27: "lowercase nonsense" sub-text, the big "55% chance of" figure looked unfinished, the K/P squares, the rough candles, the chart buried below the fold on phones, the arb panel too wide, and the home preview squeezed on phones.

## Decisions
- Price lockup: option A (in the strip) over B (a large figure right of the title). A lines up with the figures it belongs to and is shortest on phones; B left a gap on desktop.
- Logos: official files, unchanged and white (Kalshi's kit approves white on black and forbids cropping or recolouring). Kalshi has no icon, so the wordmark is used everywhere. Polymarket's full logo is drawn 1.35× taller so its wordmark matches Kalshi's; in list rows its icon is used, since the wordmark is unreadable at row height. Kalshi's site answers 429 to curl, so its kit was downloaded through headless Chrome.
- Arb width: fixed 540 px rather than fr shares. At 1fr against 1.3fr (~480 px) questions wrapped to 3 lines; 540 px keeps them to at most 2.
- Home preview on phones: CSS on the existing server-rendered panels; no second data path.

## Follow-ups
- Users with a saved Cross-venue resize keep it until they "Reset layout".
- The chart toolbar scrolls sideways on phones; "Times UTC" sits at its far end.
