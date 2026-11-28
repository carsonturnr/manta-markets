# Account page rework (2026-11-28, worktree account-page)

## What
- Signed-in /account is now terminal panels in two columns, like the Market page: Watchlist and
  Alerts in the wide column, Recently fired and API keys in the 400 px one; one column under 1000 px.
- Status is a small badge (waiting / met / ended, closed for a delisted contract, an amber
  "email failed" on a fired alert). The two paragraphs of sub-text moved into the panels' "?" tips.
- Empty states: one line and one button each, both to the terminal (the only place to watch a
  contract or set an alert). Recently fired stays hidden until something fires.
- Remove and Delete are quiet words, not 48 px mint blocks. No sideways scroll at 390 px: names
  wrap, and Fair and Last fired are hidden under 520 px.
- API keys behave as before (shown once, 3 at most, delete); the new key sits in a mint-bordered box.
- Signed-out /account: the bank artwork is gone (components/BankAscii.tsx deleted); the heading and
  Clerk's sign-in box are centred.
- CSS: one "Account" block in globals.css (.acct-*), in place of the old signed-out rules.

## Why
Carson, 2026-11-28: "the account page looks like shit, need to rework", and the sign-in art should go.
The before-shots showed the cause: every Remove/Delete drew as the site's big mint submit button,
and on a phone both tables showed only their first column.

## Decisions
- Reused the terminal's panels (.t-panel, .t-help) instead of new card styles: same look as the
  Market page and less CSS.
- Venue, close and the alert's condition sit on a second line under the name, not in their own
  columns, so one table layout works from 1440 px down to 390 px.
- Words (Remove, Delete) over an × icon: a key delete has no confirmation, so it should read clearly.
- No new dependencies, no migrations, server actions untouched.

## Verified
- typegen + tsc, lint, npm test (73 pass), `next build` + `next start` with Clerk's development keys:
  no console errors, no React error 419 (`$RX` absent), signed in and signed out.
- Real database, test account: empty state, watch + alert added in the terminal then removed here,
  key made, 4th key refused, keys deleted. Met / ended / closed / fired rows were made-up local
  fixture rows (a development user cannot reach those states); the fixture is not in this commit.
- The Clerk test user (+clerk_test, development instance) and all its rows were deleted afterwards.

## Follow-ups
- The header's Log in / Sign up pop-ups are unchanged.
- Not checked on a real phone or in Safari/Firefox: screenshots are headless Chrome at 1440 and 390 px.
