# 2026-11-25 — nav-markets

## What
- Header: Markets · Arbitrage (/compare) · Alerts (/account), then a "Pro tools" menu (Terminal, Screener table, Distributions, Liquidity, Replay, Events, Bitcoin fair value, Fair-value accuracy, Data quality), Search and "Open terminal". Every page keeps its URL.
- New /markets: one card per event (components/EventCard.tsx, getEvents()), filter chips (All, Crypto, Economics, Financials, Closing today), a text search and an order (most traded, closing soonest). First 24 cards, then "Show all N events". A line explains chance: a 37¢ contract pays $1 if it happens, so traders put it at about 37%.
- Filters live in lib/markets.ts (pick, search, order) with tests; the home page's busiest-markets section now uses the same `pick`.
- Header search, home "All markets", the not-found and error pages, and the terminal's "Markets" link go to /markets. /screener is unchanged and listed under Pro tools.

## Why
Carson (2026-11-25): the site read as too technical for a Polymarket trader. A plain-language layer comes first; the technical pages sit one level deeper.

## Decisions
- Pro tools is a disclosure menu (a button that shows a list of links), not an ARIA "menu" widget: Tab moves through the links, Escape closes it and returns focus to the button, tabbing past the last link or clicking outside closes it. On phones the list is always open inside the Menu panel under a small "Pro tools" heading, so nothing is two taps deep.
- "Most traded" compares events in dollars (Kalshi contracts × midpoint; Polymarket already reports dollars), so the two venues rank fairly. The home page keeps its existing order.
- Search needs every word somewhere in the question, family name, venue, ticker or an outcome ("fed december", "bitcoin 5 pm").
- 15-minute crypto events stay on /markets (the home page hides them).
- The search box waits for a pause in typing before applying (existing LiveForm); it works without JavaScript through an Apply button.

## Follow-ups
- Footer left as it was (Carson wants it reworked last); it still says "Screener" etc.
- Links owned by other worktrees still point at /screener: the contract page's "Back to the screener" (A), /account's empty watchlist and /liquidity's "contract page" (C).
- Signed-in header (account menu beside Pro tools) not checked: Clerk refuses localhost with production keys.
