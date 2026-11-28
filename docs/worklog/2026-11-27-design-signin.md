# 2026-11-27 design-signin: the signed-out /account screen

## What
- Sign-in screen: the pitch heading, the four selling points and the "Sign in with Google…" line are gone. One h1, "Sign in to Manta", then Clerk's form. Clerk's own title and "Welcome back!" line are hidden (`appearance.elements.header`), so the title isn't said twice. Clerk's "Sign up" switch stays.
- New artwork, components/BankAscii.tsx: an original night scene of a classical exchange building (pediment, six fluted columns lit from the left, three steps) with low hills, a paved path and sparse stars, drawn as a mint 8 x 8 ordered dither in 2 px dots. One still frame, redrawn only on resize.
- Phones: the form comes first, the art sits below it (360 px tall) and shows the whole building; the scene runs past the edges, so the art never crops through it.
- Removed the old animated logo art (components/MantaAscii.tsx) and the unused `.sell` CSS, in their own last commit.
- Signed-in account page (watchlist, alerts, API keys) unchanged.

## Why
Carson: the sign-in screen was "awful": too much paragraph text, and the art should be a bank landscape with pillars, not the logo.

## Decisions
- Dither over ASCII: both were built from the same scene. Dither is crisp and keeps the columns' shading and fluting; ASCII came out dimmer and coarse on phones. The ASCII renderer is in commit 61c45bd and removed in the next one: revert that commit to bring it back.
- Our own h1 instead of Clerk's title: it matches the site's Newsreader headings, and Clerk's welcome line is the kind of sub-text Carson wants cut.
- A still frame instead of animation: nothing to reduce for prefers-reduced-motion, and no CPU while the page sits open.
- The building is fitted to the box rather than cropped, with sky and ground filling the rest, so one drawing works at 1440 and 390 px.

## Follow-ups
- Clerk's "Sign up" goes to its sign-up screen; not checked how that screen looks next to our "Sign in to Manta" heading.
- `next build && next start` locally can't load Clerk (production keys work only on mantamarkets.com), so the form was checked on the dev server only; check the Vercel preview before merging.
- If Carson wants to keep MantaAscii.tsx, drop the last commit.
