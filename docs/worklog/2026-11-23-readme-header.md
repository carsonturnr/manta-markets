# README header in the site's own type

## What
- New `docs/images/header-light.svg` and `header-dark.svg`: Manta's mark, the "Manta" wordmark
  and the tagline "A terminal for prediction markets.", all as outlines (paths only, ~20 KB each).
- README's top block (logo, `<h1>`, bold tagline) replaced by one `<picture>` that swaps the two
  with `prefers-color-scheme`. Links row, badges and everything below stay plain markdown.
- Removed `docs/images/logo-light.svg` / `logo-dark.svg` (nothing else used them).

## Why
GitHub ignores custom fonts and CSS in READMEs, so the header was set in GitHub's sans. The site
sets its brand and headlines in Newsreader; the README should look like the same product.

## Decisions
- Text converted to paths, not `<text>` with an embedded font: GitHub serves SVGs as images, which
  cannot load fonts, and outlines keep the files small.
- Newsreader 400 at its default optical size (the instance the site serves), letter-spacing
  -0.03em; mark 1.3em wide with a 0.22em gap, centred on the text as in `.brand`. Wordmark at the
  hero's 72 px, tagline 34 px so it still reads at phone width.
- Colours from `site/app/globals.css`: dark theme `--text` #f2f2f2 / `--text-2` #9a9a9a; light
  theme black / `--text-3` #6b6b6b. Transparent background. Mint left out: it does not read on white.
- No mono "mantamarkets.com" line: the links row right below already links the live site.
- Fonts downloaded from google/fonts and outlined with fontTools + uharfbuzz run from a scratch
  folder; no font files or dependencies added to the repo.

## Follow-ups
- To change the header text, regenerate the SVGs (the script lived in a scratch folder and is not
  committed; it is ~40 lines of fontTools + uharfbuzz).
