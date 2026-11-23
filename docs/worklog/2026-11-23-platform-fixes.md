# 2026-11-23 platform fixes

## What
- CI: a `site` job runs the AGENTS.md checks (npm ci, typegen + tsc, lint, tests) on Node 24 with no secrets. Passed on this PR in 1m26s.
- Replay server (8790) serves TLS with the relay's certificate; `-tls-cert ""` serves plain HTTP for local testing. The site reads it through `lib/vm.ts` (node:https, trusts only RELAY_CA), which also accepts http:// for the switch-over. `deploy-replay.sh` stops if the certificate is missing.
- Terminal: Kalshi books and trades stream from the relay (`/api/live/stream`, SSE passed through). `/api/live` polling stays for Polymarket, while the stream is down or its book not live, and once on load for trade history. Label reads "live · streaming" or "live · every 2 s".
- Relay pushes 50 levels a side (was 10), matching what the site reads from Kalshi.

## Why
Follow-ups from the relay and terminal worklogs: site checks weren't in CI, the replay token and files crossed the internet in the clear, and the deployed relay wasn't used.

## Decisions
- One certificate for both VM services: same VM and name, no new Vercel variable; only REPLAY_URL changes to https://.
- node:https over adding undici (no new dependency).
- Measured (local `next start` on the production relay): streamed changes reach the client in 93 ms median (p90 217 ms); 2 s polls were current 85% of the time, plus up to 2 s waiting for the next poll. Browser: 1 /api/live request in 55 s streaming vs 16 in 32 s polling.

## Deploy plan (each step needs Carson's go-ahead)
1. Merge: the site works with today's settings (RELAY_* already in Vercel; REPLAY_URL still http).
2. `infra/deploy/deploy.sh root@<vm-ip>`: restarts the recorder (50 levels, plus the pending closed-markets fix). Short recording gap.
3. `infra/deploy/deploy-replay.sh root@<vm-ip>`: replay server on TLS. Replay and event pages fail until step 4.
4. Vercel Production: REPLAY_URL=https://<vm-ip>:8790, then redeploy. Check /replay loads and plain HTTP to 8790 gets 400.

## Follow-ups
- Not tested: a relay drop mid-stream (EventSource should reconnect; polling covers the gap); Polymarket in the browser (code path unchanged).
- Vercel ends streaming functions at their max duration; check function time and cost after a day.
- One poll measurement read 52 s behind the stream (likely a price returning to an old value); not investigated.
- After step 4, `lib/vm.ts` could refuse http://.
