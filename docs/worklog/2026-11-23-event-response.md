# Event response, step 1: clock check and formulas

## What
- Measured series-1's clock and the venues' own message timestamps (dated line in docs/decisions.md).
- New package `recorder/internal/eventresponse`: pure functions over one contract's time-ordered
  book samples: `Move`, `TimeTo90`, `Thinning`, `SpreadAt` (plus `Sample.Mid/Spread/Depth`).
- 7 tests with hand-made series: clean 40¢ → 46¢ move with 90% at +2.4 s, a stray quote inside
  the 10 s hold (rising and falling moves), a one-sided book breaking the hold, a move already
  done at t0, a zero move, no quotes / quotes only after t0 / one-sided, book thinning 1,000 → 120.

## Why
Plan step 1 (docs/plan-event-response.md on carsonturnr/positioning): sub-second timings are
only worth showing if our clock is trustworthy, and the formulas need tests before any command
or page uses them.

## Decisions
- VM clock: systemd-timesyncd (no chrony), +47 µs from ntp.hetzner.com, 24 ms worst-case bound.
  Good enough; nothing changed on the VM.
- Kalshi stamps every book change and trade (`ts_ms`); our receive time trails it by ~55 ms
  (p99 88 ms, max 0.7 s). Proposed: time Kalshi reactions by `ts_ms` (already in md.Book's
  VenueTsMs), receive time as fallback. Awaiting Carson.
- Samples reuse `book.Level` (fixed-point), so step 2 can feed `book.Levels` from the replay's
  rebuilt books with no conversion. Times in unix ms, the unit of Kalshi's own timestamps.
- "The book at t" = last sample at or before t; "just before t0" = last sample strictly before.
  A sample exactly at t0 is the reaction, not the baseline.
- A moment with no mid (one side empty) breaks the 10 s hold: we can't say the price was past.

## Follow-ups
- Step 2: `recorder/cmd/eventresponse` on one recorded hour (Carson's go-ahead first).
- "Spread against its usual value" needs a baseline definition (e.g. median spread over
  t0 − 15 min to t0 − 1 min); not built.
- Receive-time lag in a release burst is unmeasured until Dec 4 (today's max 0.7 s).
