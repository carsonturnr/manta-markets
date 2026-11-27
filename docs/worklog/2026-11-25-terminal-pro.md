# 2026-11-25 — terminal-pro

## What
- Resizable terminal: drag the border between any two panels in /terminal, or focus it (Tab) and use the arrow keys (16 px a press, 64 with Shift). Each handle is a `role="separator"` with a label ("Resize Markets and Price") and `aria-valuenow` (the left/top panel's share in %). Sizes are kept per layout in localStorage; "Reset layout" in the command bar (⌘K) puts the layout back. The four presets are unchanged as the starting sizes; phones still stack the panels and show no handles.
- Brief panel (AI): the market brief for the contract in focus, in the Market layout (bottom left, under Markets) and Catalysts (under the calendar), labelled "AI summary of Manta's data. Not investment advice."; if the summary fails it says so in one line.
- A "?" on every panel header: one sentence on what the panel shows, on hover, keyboard focus or tap.
- Command bar: fixed a duplicate React key (the "Layout: Market" command and the focused market's row shared a link).

## Why
Carson asked for resizable panels, an AI panel and plain-language help so a trader who knows stock charts but not prediction-market terms can use the terminal.

## Decisions
- No dependency: `components/terminal/ResizableGrid.tsx` measures the CSS grid the layout already draws and puts a handle over each border between two different panels; a drag trades size between the two tracks beside it (min 120 px), set inline as `fr` weights. The pure parts (which borders, how a drag resizes) are in `lib/grid.ts` with tests.
- A border that runs only through the middle of one panel (the chart spans two columns) gets no handle there, so the chart's crosshair isn't interrupted.
- A drag turns that layout's fixed-width columns (Markets 300 px, Book 330 px) into proportions, so they then scale with the window; reset brings the fixed widths back.
- Brief panel calls `getBrief` (same cache and model as the market page) rather than reusing `MarketBrief`, which renders nothing on failure and would leave an empty panel.
- Help is a CSS tooltip on a real button (readable by screen readers through its label), not the `title` attribute, which keyboards and phones can't open.

## Follow-ups
- Home demo (worktree D's page.tsx): unchanged and still works (layout tabs checked). Its panel headers could use the same help sentences: `HELP` is exported from components/terminal/Panels.tsx.
- Chart drawing, recommendation: worth a small first version, not a drawing suite. Prediction-market traders do mark levels (a price they'd buy at, yesterday's high, the fair value they disagree with), but trend lines mean little on a contract that converges to 0 or 100 at the close. lightweight-charts 5.3 (installed) covers the first step with no plugin: `series.createPriceLine` for horizontal levels (about a day: click "Level", click the chart, drag or delete it, saved per contract in localStorage). Trend lines need a custom series primitive (`attachPrimitive` with a canvas renderer, hit-testing for drag): about 3-4 days, and they'd need re-anchoring when the timeframe changes. Build horizontal levels first, and only add lines if people ask; a natural extension is turning a level into a price alert (alerts already exist).
- Not checked: signed-in terminal (Clerk refuses localhost with production keys); the live stream (no relay locally, the terminal fell back to polling).
