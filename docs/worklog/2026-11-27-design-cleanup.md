# 2026-11-27 — design-cleanup

## What
- globals.css: removed the `.band` rules (the old home tools band) and the `.event-card` card styles (`.event-q`, `.event-meta`, `.event-outcomes`, `.outcome`, `.outcome-lab`, `.event-foot`): 102 lines. No element uses them.
- components/EventCard.tsx: removed the unused default export (the card) and the helpers only it used (`eventHref`, `volumeText`, `Verdict`). `pct`, `closesIn` and `ProbBar` stay; Markets and the Market page use them.

## Why
Carson approved the cleanup left as a follow-up by the 11-25 and 11-26 worklogs.

## Decisions
- Checked every class in globals.css against the site's code; classes built in template strings (`t-grid-${layout}`, `cell-${state}`, `t-sep-*`) were kept.
- `verdict()` in lib/outcomes.ts is now used only by its tests; kept, as it is tested and small.

## Follow-ups
- None. Typecheck, lint and tests pass; nothing on screen should change.
