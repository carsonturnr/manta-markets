# Market page and terminal: one set of panels (market-unify)

## What
- The Market page (/m/<venue>/<event>?o=<id>) is built from the terminal's own panels: price chart, live order book, depth, trades, cost to trade, fair value, the other venue's price (paired markets), every outcome, likely range (ladders), the Bitcoin fair-value ladder (Kalshi Bitcoin) and the AI brief, in two columns on a desktop and one on a phone, wrapped in the same `<Live>` feed. The settlement rule closes the page in one plain sentence; the venue's full rules fold away.
- One frame for every panel (`Panel` in components/terminal/Panels.tsx, with the codes, titles and "?" help), used by both pages.
- One cost calculator: CostCalc (buy or sell N contracts: all-in cost, average price, slippage, fee, versus fair value) is the terminal's COST panel too. BuyBox and `buyWithBudget` are gone.
- Gone as duplicates: BookSection, TradesSection, CostSection and Watch in ContractSections.tsx (Watch folded into AlertsPanel), the page's own fair-value card and outcome list, Tabs.tsx, and their CSS (about 380 lines of rules no page uses).
- "Open in terminal" on every Market page; the terminal's focus bar links to "Market page →". Terminal tool links: Distributions and Replay removed.
- Old pages are now route handlers that redirect (307) to the Market page: /contract/<venue>/<id> and /c/<ticker> with that outcome selected, /tracker to the next Bitcoin "above" ladder, /distributions(?e=) to that ladder's Market page.
- The fair-value panel's accuracy line says "Error score, lower is better" and defines the Brier score in a phrase.

## Why
Carson's finish brief: one set of components for the Market page and the terminal, links both ways, and the tracker, distributions and contract pages folded in.

## Decisions
- Panels stay where the terminal had them (LivePanels.tsx client, Panels.tsx server); ContractSections keeps only what isn't a panel (Chart, rules, venue link) plus `MarketBrief`, a heading around BriefPanel for the home page.
- Kept CostCalc over BuyBox: "cost of N contracts with fees and slippage" is the brief's wording, and CostCalc already showed slippage and the fair-value comparison. Its URL syncing went with the contract page.
- Redirects are route handlers, not next.config entries: the target needs a database lookup (contract → event). Closed Kalshi contracts fall back to the event from the ticker (which then shows "Not open"); settled-contract history from /c is no longer shown.
- Replay: dropped from navigation (terminal links), not made a panel; /replay still works for Insights to reuse.
- Every outcome panel hides strikes under 2% or over 98% on long ladders, in the terminal too (it was only the Market page's rule).

## Follow-ups
- Header and footer (worktree H) still link /tracker, /distributions and /replay; the redirects keep the first two working.
- Home (worktree H) still imports `Chart` and `MarketBrief` from ContractSections; both kept. Its Chart call passes no Polymarket token.
- The terminal's tool links (Markets, Compare, Liquidity) should point at Insights once it exists.
- GapChart lost its only user (/c); worktree I owns it.

## Redirects
- /contract/<venue>/<id> → /m/<venue>/<event>?o=<id> (route handler, needs the lookup)
- /c/<ticker> → /m/kalshi/<event>?o=<ticker> (route handler)
- /tracker → next Bitcoin ladder's Market page (route handler)
- /distributions, /distributions?e=<venue>/<event> → that ladder's Market page (route handler)
- /replay: kept, out of the terminal's navigation
