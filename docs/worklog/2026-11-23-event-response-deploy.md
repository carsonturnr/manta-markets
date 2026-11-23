# Event response, step 3: run trigger and deploy prep

## What
- `infra/deploy/releases.tsv`: the release calendar (Dec 4 payrolls, Dec 9 Fed, Dec 10 CPI, and
  January's three), each t0 checked against Kalshi's close times on 2026-11-23.
- `replay.sh` (the existing hourly replay timer): for each release whose window has closed, with
  no file yet and raw files still on the VM, runs `eventresponse` on every hour from t0 − 35 min
  to t0 + 30 min, with the VM clock offset and bound read from `timedatectl` at run time. Runs
  before the replay; a failure is logged, retried next hour, and fails the unit at the end.
- `deploy-replay.sh` also builds and installs `eventresponse` and ships the calendar; it installs
  only the binaries it builds (the others in /opt/manta/bin stay).
- `/events/[release]`: charts the 24 biggest movers (a real release moved 193 by ≥ 1¢); the table
  still lists every contract.
- Nav: Events after Replay. Terminal Catalysts panel: a link to past releases.

## Why
Plan step 3 (docs/plan-event-response.md): the tool must measure its first real release,
payrolls on 2026-12-04 13:30 UTC, with no one at the keyboard.

## Decisions
- Trigger inside replay.sh, not a new timer: the plan says so, and it shares the replay unit's
  CPU (50%) and memory (1,500 MB) caps. A new timer would need its own caps and could overlap.
- Calendar as a file next to the script, one shared series list in the script: one place to add
  a release.
- replayserve already serves `events/` (page worktree), but the VM's binary is from Nov 17: the
  deploy restarts `manta-replayserve`. The recorder is not touched or restarted.
- Chart cap 24: the dry-run page was 6.9 MB with 193 charts, 2.4 MB with 24 (dev server).

## Follow-ups
- Deploy needs Carson's go-ahead, then one stand-in run on the VM to time it under the caps.
- Open decision for Carson: release times from Kalshi `ts_ms` (as built) or receive time.
- No FX hourlies (KXEURUSDH, KXUSDJPYH) open or recorded on 2026-11-23; kept in the list.
- Page still ~2.4 MB (mid series in both SVG and the RSC payload); thin the series if it is slow.
- platform-fixes (replay TLS) may also edit deploy-replay.sh: merge with care.
