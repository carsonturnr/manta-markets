# Event response, step 2 (command half): recorder/cmd/eventresponse

## What
- `recorder/cmd/eventresponse`: rebuilds each listed Kalshi contract's book over t0 − 15 min to
  t0 + 30 min (20 min warm-up) and writes `DIR/events/<release>.json` in the shared contract
  (mids per second, move, time to 90%, depth 10 min / 30 s before, spread at t0, usual spread,
  changes). Biggest moves first; contracts with no two-sided price in the window left out.
- `rawlog.Stream`: reads a raw file as it decompresses (replay's `ReadFile` holds the whole hour).
- `eventresponse.UsualSpread` (time-weighted median) and `eventresponse.Near` (keep only the
  levels the figures read), with hand-checked tests; a test for the mid series.
- Demo on 2026-11-23 14:00 UTC (Bitcoin stand-in), measured cost and Kalshi ordering in
  docs/decisions.md.

## Why
Plan step 2 (docs/plan-event-response.md on carsonturnr/positioning): the command on one
recorded hour, before the first real release (payrolls, 2026-12-04 13:30 UTC).

## Decisions
- Times: Kalshi `ts_ms`, receive time for snapshots (the normalizer gives them none). A change
  stamped earlier than the previous one (0.08%, ≤ 527 ms) is placed at the previous one's time.
- Trust like the relay (subscribe record, gap or disconnect → out until the next snapshot), not
  like replay, which ignores connection-wide gaps. An untrusted moment is an empty sample, so
  the last good book doesn't appear to stand through it.
- Usual spread time-weighted: the spread at a typical moment, not at a typical quote update.
- Mid points stamped when the mid took the value, so storing fewer samples changes nothing.

## Follow-ups
- `replayserve` doesn't serve `events/` yet (its index skips the folder): a route is needed
  with step 3's deploy, or in the page worktree.
- The stand-in's jump came at 13:55–14:00, before t0, so its "time to 90%" (~26 min) measures a
  slow drift, not a reaction. Dec 4 is the first real test.
- Cost is parsing every Kalshi record (~170 s CPU for 45 min + warm-up); a byte prefilter is
  impossible without breaking the per-connection seq check. Fine for 3 releases a month.
- Deploy and the run trigger (step 3) need Carson's go-ahead.
