# 2026-11-23 — linkedin-header

## What
- marketing/linkedin-header.png (1200 × 627, LinkedIn Featured card) and marketing/og-image.png (1200 × 630), both from marketing/linkedin-header.html: the hero line "A terminal for prediction markets.", the mark and wordmark, mantamarkets.com, and a real crop of the live terminal's Trades panel (marketing/terminal-tape.png, 2026-11-23 15:25 UTC).
- New mark in components/Mark.tsx, traced from Carson's reference drawing; sized in ems (1.3em wide, 0.22em gap) in the site and terminal headers.
- New favicon.ico (16/32/48), app/icon.svg and app/apple-icon.png (180 × 180): white mark on black. The old favicon was Next's default.
- .claude/hooks/verify.sh and AGENTS.md: run `next typegen` before `tsc --noEmit`.

## Why
Carson wanted a LinkedIn Featured image in the site's own style, then a mark that looks like a manta.

## Decisions
- Headline is the homepage hero, not a new line; fonts, colours and rails come from globals.css and layout.tsx, so the card looks like the site.
- UI accent is the Trades panel: the live site's order book and chart still show "Manta" fair-value labels (positioning not deployed yet), which the positioning rule rules out.
- Mark traced from the bitmap (per-column edges, mirrored, smoothed) after a hand-drawn manta was rejected; size and gap chosen by Carson from a grid with a fixed wordmark.
- Mark and favicon are white on black, not mint: mint is already used for buttons and "buy" figures.
- og-image.png is not wired into the site's metadata (Carson didn't ask).

## Follow-ups
- Wire og-image.png as site/app/opengraph-image.png if Carson wants link previews.
- The HTML loads its fonts from Google Fonts, so re-rendering needs the network.
- The tail of the mark mostly disappears at 16 px.
