# AGENTS.md — Manta

Manta (repo/package `manta-markets`) is an analytics terminal for prediction markets (Kalshi, Polymarket): screener, contract pages, cross-venue compare, fair values, cost to trade, history/replay, accuracy stats; a Kalshi market maker comes last. Product spec: docs/product.md. Dated decisions and measured facts: docs/decisions.md. It replaces the retired Series project: no private-company exchange, custom matching engine, perps, margin or guest trading.

**Every step ends in something that runs and can be shown.** Live site: https://mantamarkets.com.

Build order (steps 0–13), fee formulas and infra (VM, Storage Box, Vercel, Supabase): docs/agent-reference.md. Real infra values (VM IP, Storage Box user, Vercel team) are in `infra.local.md` at the repo root: gitignored, copied into worktrees by `.worktreeinclude`; ask Carson if it is missing.

## Stack

- **recorder/** Go 1.27: records raw venue messages (Kalshi, Deribit, Coinbase, Kraken, Polymarket, Binance) to hourly gzip JSONL files.
- **pricing/** Python 3.13 + uv: fair values and analytics, writes Postgres (`manta-fair`, `manta-snap`, `manta-quality`, `manta-contracts`).
- **backtest/** Python 3.13 + uv + NautilusTrader `==2.0.0rc9` (exact pin, release candidate): recordings → Nautilus Parquet catalog.
- **site/** Next.js 16 + React 19 + TypeScript (npm), Clerk sign-in, `postgres` client, deployed on Vercel. Next 16 differs from training data: read `site/AGENTS.md` and `node_modules/next/dist/docs/` before writing site code.
- **db/schema.sql** Postgres on Supabase, schema `manta`. **infra/deploy/** VM scripts and systemd units.

## Commands

Site (run in `site/`):
- Install: `npm ci` · Dev: `npm run dev` · Build: `npm run build`
- Typecheck: `npx next typegen && npx tsc --noEmit` (no script in package.json; typegen writes the `PageProps`/`LayoutProps` types into .next/) · Lint: `npm run lint` · Test: `npm test` (`node --test lib/*.test.ts`)

Python (run in `pricing/` or `backtest/`, same as CI):
- `uv sync --locked` · `uv run ruff format --check .` · `uv run ruff check .` · `uv run pytest -q` (backtest has no tests yet)

Go (run in `recorder/`, same as CI):
- `gofmt -l .` (must print nothing) · `go vet ./...` · `go test ./...`

CI (.github/workflows/ci.yml) runs the recorder, pricing and site checks (site: no secrets, Node 24).

## Layout

```
recorder/cmd/          binaries: recorder, status, rawcat, normalize, contracts, replay, replayserve
recorder/internal/     tap (venue clients), rawlog, book, contracts, crossvenue, normalize, replay, md, fixed
pricing/src/manta_pricing/   fair-value model and analytics; tests in pricing/tests/
backtest/src/manta_backtest/ catalog, check, fairseries
site/app/              one folder per page (screener, c/[ticker], contract/[venue]/[id], compare, liquidity, distributions, replay, stats, quality, tracker, account, privacy)
site/components/       charts and forms
site/lib/              queries and pure analytics; tests are lib/*.test.ts next to the code
db/                    schema.sql, one-off SQL
infra/deploy/          deploy.sh (VM), systemd units, nightly archive
docs/                  product.md, milestone plans, decisions.md
```

## Conventions seen in the code

- Simple, readable code over clever code. Every part should be easy to explain.
- Comments explain the *why* in plain English, often with the measurement and date behind a choice (see `site/lib/db.ts`). Every finance/math term is defined the first time it is used.
- Formulas get tests with known inputs and hand-checked outputs (`site/lib/cost.test.ts`, `pricing/tests/`).
- Site: `@/*` path alias, strict TypeScript, pages read the DB only at request time (never during `next build`), through the read-only `manta_site` login and Supabase's **session** pooler (5432; `db.ts` refuses 6543).
- Python: ruff, line length 100, rules E F I B UP SIM. Go: gofmt.
- New decisions get a dated line in docs/decisions.md: decision — what was found/measured.

## How to work with Carson

- Plain language; define jargon. Small steps, one at a time; don't build ahead.
- Take a position: recommend one option and say why.
- No scope creep: anything not in docs/product.md's build order is proposed and waits.
- Say what you verified and what you didn't. Never call something working unless you ran it.
- Before writing new code, look for something reusable in the repo; ask before deleting or rewriting it.

## Hard rules (money, safety, data)

- **Paper trading only**: backtests, Nautilus sandbox, Kalshi demo. No live-money order path unless Carson raises it himself (then: explicit go-ahead, off-by-default flag, $200 hard cap with kill switch).
- **Kalshi only for orders.** Deribit, Polymarket, Binance and all other sources are read-only.
- **No sports markets, ever**. Only crypto, economics and financial contracts, each on an explicit allow-list checked against the venue category; labels alone aren't enough (Kalshi files a "Football Fun" series under Crypto). Not even for testing.
- **Secrets** stay in `.env`, `site/.env*.local`, `/etc/manta/env` and Vercel settings. Never commit or log them.
- **Personal data** (waitlist/account emails): row-level security, covered by the privacy policy, deletable, never logged or committed.
- **NautilusTrader** (LGPL-3.0): import it, never copy its source; credit it in the README. Report adapter bugs to Carson for upstream, work around them in our code.
- Data terms: showing venue data, derived analytics and an API of derived analytics is allowed; no bulk redistribution of raw venue data.
- Facts about venues (tickers, settlement, fees, schedules) are in docs/decisions.md; check against the live API before relying on a new one. Read prices from order books, not Kalshi's market list (it lags ~1 minute). Fees come from each series' `fee_type`/`fee_multiplier` (Kalshi) and `feeSchedule` (Polymarket).

## Definition of done

- Recorder has run for at least four weeks with gaps logged, and the data-quality page shows it.
- Every tool in docs/product.md is live on the public site, each with its method explained in plain English.
- Fair values are tested and labelled by method; accuracy statistics are published with honest sample sizes.
- The waitlist is live, after the data-terms checks.
- The market maker's backtest report and paper-trading results show the profit-and-loss breakdown.
- README explains the project in plain English, credits NautilusTrader, states what worked and what did not, and includes the real numbers, including unflattering ones.

## Never (without asking Carson first)

- Edit `.env` files (`.env`, `site/.env.local`, `site/.env.production.local`, `/etc/manta/env`).
- Write or run database migrations (changes to `db/schema.sql`, any DDL against Supabase).
- Add, remove or upgrade dependencies (package.json, pyproject.toml, go.mod).
- Deploy: `vercel`, `infra/deploy/*.sh`, `git push`, restarting VM services.
- Commit to `main`, force-push, or `rm -rf`.

## Learned rules

- Site (Next 16, Cache Components): a client component that calls `usePathname()` or `useSearchParams()` must sit inside `<Suspense>`, or every page errors with "URL data outside of <Suspense>" (components/NavLinks.tsx).
- Site: the CSS minifier shortens hex colours (`#00ff77` → `#0f7`), so code reading CSS tokens with getComputedStyle must accept 3-digit hex (components/CandleChart.tsx `alpha`).
- Site (Next 16 PPR + Clerk 7.9): loading `@clerk/nextjs`'s client code renames Clerk's provider (`displayName`); if the build's prerender and a request see different names, React discards the server HTML on every page (error #419, `$RX` in the HTML). components/ClerkFirst.tsx loads it first in app/layout.tsx; keep it. Check with `next build && next start`: the dev server never shows this.
- Measure live-path CPU by streaming records (`gzip -dc FILE | …`, or `rawlog.Stream` in Go), not `rawlog.ReadFile`: it holds the whole compressed hour in memory and garbage collection then inflates the cost (relay: 4m15s vs 3m17s an hour).
- infra/deploy/*.sh share /opt/manta/bin: a deploy script must keep the binaries it did not build (deploy.sh once swapped the folder for its own three, which would have dropped replay, replayserve and contracts).
- State kept per Kalshi market in a long-running process must be dropped when the market closes (the next `subscribe` record omits it, `normalize.Subscribed`): short-dated markets roll all day (relay held 20,416 markets after 15 h, 5,700 open).
- Positioning (Carson, 2026-11-15, repeated 2026-11-23): Manta is a tools / trading-terminal product. Copy, headlines and page order lead with the tools (screener, books, compare, cost, distributions, replay, alerts); fair value is one tool among them, never the pitch.
- Site: `PageProps` and `LayoutProps` are global types that Next generates into `.next/types`; in a fresh worktree (no `.next/`) `tsc --noEmit` fails with "Cannot find name 'PageProps'" until `npx next typegen` runs.
- Site: a lib file with node tests (`npm test`) must not import `next/cache` or `./db`: node cannot resolve `next/cache` as ESM, and db.ts throws without DATABASE_URL. Use a bare `"use cache"` (default profile) or keep the Next-only code in another file (lib/events-response.ts, lib/replayserve.ts).
- Infra details (IPs, hostnames, account usernames) go in gitignored local files (`infra.local.md`), never in tracked docs; tracked files use placeholders such as `<vm-ip>`. The repo is meant to be public.
- Database DDL: the Supabase MCP connection is read-only (`supabase_read_only_user`). Approved migrations run with the admin `DATABASE_URL` from the repo-root `.env` (psycopg via `uv run` in pricing/), never printing the URL; the VM's `manta-snap --init` applies the whole of db/schema.sql on the next deploy.
- API routes (site/app/api/v1): call `authorize()` before validating the query, so a caller without a valid key always gets 401, never a 400 that reveals the query rules (/cost did it the other way round until 2026-11-23).
- Site CSS: `.panel` has `overflow: hidden`, which stops `position: sticky` inside it (table headings stay put); a sticky child needs that panel set to `overflow: visible` (globals.css `.panel:has(> .screener-table)`).
- Kalshi's website answers 429 to curl and fetch tools; check a kalshi.com URL in a real browser (its API at api.elections.kalshi.com is fine).
- Site CSS: globals.css is one flat file shared by every page and merged often. Parallel worktrees all append to its end, so merges conflict there: after resolving, count `{` against `}` (comments stripped) before committing; deleting the conflict markers alone once left a phone `@media` block open and every later rule applied on phones only (2026-11-25). Grep a class name before using it (`.ladder` belongs to the event page).
