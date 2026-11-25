# 2026-11-25 — home-arbitrage

## What
- Home: a plain headline ("Every Kalshi and Polymarket market, in one place."), one sentence on what Manta gives a trader (AI summary of what's moving, price gaps between the venues after fees, alerts), "Browse markets" (/markets) and "Open the terminal". The live terminal demo under the hero is unchanged.
- Below it: today's busiest markets as cards with one line on reading a price as a chance; the AI market brief on Kalshi's most-traded market (the same contract the demo shows), hidden when the brief is; up to four live arbitrage gaps in one sentence each ("Buy yes on Polymarket at 17¢, sell yes on Kalshi at 22¢: 3.7¢ left per contract after fees, on up to 100 contracts."); a "For advanced traders" band linking Terminal, Screener table, Distributions, Liquidity and Replay; a shorter API waitlist.
- Removed from home: the stats row (including "recorder coverage, worst venue"), the eight-tool list with figures, and "What the ladders imply".
- /compare: opens with arbitrage in one sentence; one line defines "after fees" and "size"; match kinds in words ("Same bet on both venues", "Bundle: several Polymarket ranges bought together match one Kalshi contract", "Near match. <what differs>"); "Gross" → "Price gap", "In all" → "Profit at full size"; "crosses" → plain wording. The folded per-event tables stay.
- `arbitrage()` in lib/compare.ts: the after-fee gaps, best first, with size; used by both pages (moved out of the compare page, same math).

## Why
Carson (2026-11-25): the home page opened like a quant tool. A Kalshi or Polymarket trader should see what they can act on first; the technical views stay one level deeper.

## Decisions
- The brief goes on the demo's contract (Kalshi's most traded in dollars), so the page talks about one market; `topKalshi()` is shared by both.
- The brief section asks `getBrief` first (cached 5 minutes) and renders nothing on failure, so no empty heading shows.
- Kept the busiest-markets filter chips; dropped the distributions block (it's listed in the tools band).
- Checked with the real API key: the brief renders five plain bullets on the home page.

## Follow-ups
- Unused CSS left in globals.css to avoid conflicts with the parallel worktrees: `.stats-row`, `.figures-row`, `.ranked-fig`, `.ranked-gap`, `.band-note`, `.dumbbell`. Delete in one cleanup pass after the merges.
- A gap that rounds to 0.00¢ after fees still shows (pre-existing threshold of 1e-9¢); a minimum worth showing (say 0.1¢) is Carson's call.
- The footer still says "Compare venues" and "Screener"; it belongs to the footer task.
- Signed-in header not checked (Clerk refuses localhost with production keys).
