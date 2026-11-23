# News sources: when did it happen, on our clock?

Research for tool 16 (news events), build order 13c. 2026-11-23. No code, no sign-ups.

**Goal.** Put market-moving news on the same clock as the order books (series-1, synced to
ntp.hetzner.com; Kalshi stamps each message with `ts_ms`, milliseconds). Two kinds of news:
*scheduled* (CPI, payrolls, GDP, the Fed's decision, Treasury auctions) and *unscheduled*
(a surprise statement, a sanction, a resignation).

**Words.** *Stated time*: the time the source says it published ("8:30 a.m. ET").
*Written*: the page's `Last-Modified` header, when the file was saved on the source's server.
*Received*: when our poller first got it. *Lock-up*: a locked room where reporters get a release
early and file it at the release time; whoever is in it is faster than the public website.
*Wire*: a paid news feed (Dow Jones, Reuters, Benzinga).

## Official sources

| Source | How it publishes | Timestamps | Lock-up | Automated access |
|---|---|---|---|---|
| **BLS** (CPI, payrolls) | release pages, RSS/Atom per release, ICS calendar, API v1 (no key, 25 queries/day) / v2 (key) | stated minute only ("embargoed until 8:30 a.m. (ET)") | ended 3 Jun 2020: website and wires at the same time | **blocked**: a generic client gets HTTP 403. BLS "reserves the right to block robots that do not contain information that can be used to contact the owner" (bls.gov/bls/blsterms.htm) |
| **BEA** (GDP, PCE) | release pages, RSS (apps.bea.gov/rss/rss.xml), ICS + JSON calendar (UTC times), API (key) | RSS `pubDate` = stated time (Fri 08:30:00 EST) | suspended Mar 2020; at most rare, logged, ≤ 30 min early to officials | open; API 100 requests/min |
| **Federal Reserve** (FOMC, minutes, speeches, H.15 rates) | press-release and speech RSS (federalreserve.gov/feeds/), JSON calendar of every event (`/json/calendar.json`), release pages | RSS `pubDate` = stated time to the minute, GMT | FOMC statement had one in 2013–15; today's status not verified | open, behind Cloudflare; no stated rate limit |
| **Treasury** (auctions, statements) | TreasuryDirect JSON API and per-auction result XML (no key), press-release page (no RSS), Fiscal Data calendar API | auction close to the minute; API `updatedTimestamp` to the second | results go first to dealer terminals | open; no stated limits |
| **DOL** (jobless claims) | one PDF, dol.gov/ui/data.pdf | `Last-Modified` = 8:30:00 exactly | ended 2020 | **blocked** like BLS (HTTP 403) |

All are public domain: we may show the text with "Source: Board of Governors…" etc. (Fed, BLS
disclaimers; Treasury, BEA assumed, not checked).

## Measured delays (a development Mac, generic client name, conditional requests)

Mac clock vs ntp.hetzner.com: +34 ms ± 140 ms, small next to these delays.

**From the source's own files** (stated time → written, past items; excludes pages edited later):

| Source | n | median | range |
|---|---|---|---|
| Fed press releases (incl. FOMC statement 28 Oct: 18 s, minutes 18 Nov: 15 s) | 17 | 23 s | 12–97 s |
| Fed speeches | 14 | 17 s | 11–81 s |
| Treasury auction result XML (close → written, last 60 days) | 58 | 146 s | 117–303 s |
| Fed H.15 page (20 Nov), Fed CP page (23 Nov) | 2 | 3 s, 4 s | |
| BEA RSS, DOL PDF | — | `Last-Modified` equals the stated time to the second: not a real write time, measure live | |

**Live, first receipt by our poller** (polled every 5 s in release windows, 30–60 s otherwise):

| Item (23 Nov) | stated / close | written | received | note |
|---|---|---|---|---|
| Treasury press release sb0698 | 18:00:00 | 18:00:39 | 18:01:33 (93 s; previous poll 18:00:32) | 60 s polling; at 5 s it would be ~40–45 s |
| 2-year note auction result XML | 18:00:00 | 18:02:47 (167 s) | — | file name guessed; poller bug, not polled in time |
| same, TreasuryDirect JSON API | 18:00:00 | API record 18:03:53 | 18:03:56–18:04:02 (~240 s) | API lags the XML by ~70 s |
| 13/26-week bills, CP | 16:30, 18:00 | 16:32:38 (XML), 18:00:04 | — | missed (poller bug, since fixed) |

Reliability seen in 3 h: the Fed's press RSS returned 404 on 6 of ~340 polls (fine on the next);
one 2-s DNS failure on the Mac's connection. A real collector belongs on the VM, polling two URLs.

**Not measured yet**: BEA GDP + PCE (Wed 25 Nov 13:30 UTC), DOL claims (same time; blocked),
Beige Book (Wed 19:00 UTC), Fed H.15/H.10 live (today 21:15 UTC). The poller keeps running
until Wed 19:30 UTC (scratchpad, not the repo).

## Real-time wires (from published pages; none tested, none signed up for)

| Feed | Cost | Delivery, timestamps | May a public commercial site show headlines? |
|---|---|---|---|
| **Alpaca News** (Benzinga content) | free with an account (unverified), $99/mo data plan | WebSocket push; UTC, whole seconds in examples | **No**: "you cannot redistribute Alpaca API data" |
| **Benzinga** direct | quote only | WebSocket; seconds with offset | headline + attribution + link, per a reseller's terms; Benzinga's own contract decides |
| **Massive (Polygon)** | news in all plans (hourly); Benzinga add-on $99/mo | REST; UTC seconds | individual plans "personal, non-business use"; display needs Business ($2,499/mo, unverified) |
| **Finnhub** | free tier | REST (WebSocket paid); Unix seconds | **No**: "strictly for personal use", no redistribution without written approval |
| **Tiingo** | $30–50/mo | REST crawler; UTC | **No** below a quoted "Redistribution/Display" licence |
| **X API** (official accounts) | ~$0.005 per post read: cents a month | filtered-stream push | terms not checked; embedding posts is the usual route |
| Dow Jones / Reuters / Bloomberg | enterprise quote | lowest latency | by contract |

No wire publishes a latency figure; every vendor stamps whole seconds at best, coarser than our books.

## Recommendation

1. **Scheduled news needs no feed for timing.** The event time *is* the stated time (CPI 8:30:00 ET),
   published in advance: BEA's JSON calendar (UTC), the Fed's JSON calendar, BLS's ICS (needs
   contact info in the client name), Treasury's auction API (close times). Event-response (tool 15)
   should align on these. To show *what* was released, link the official page.
2. **Unscheduled official news: poll the Fed's RSS and Treasury's press page from the VM**, every
   10–15 s (Fed is cached by Cloudflare; use conditional requests), and Treasury's result XML every
   5 s for 5 minutes after each auction close. Expect ~20–60 s behind the stated time for the Fed
   and Treasury statements, ~2.5 min for auction results. Free, and we may show the text.
3. **A paid wire waits.** Nothing affordable lets us show headlines; the official sources cover what
   moves our contracts. If Carson wants unscheduled headlines later: Benzinga with a written display
   licence, or the X API for official accounts (cents), after reading X's terms.

## Needs Carson

- **BLS and DOL block anonymous clients.** Reading them automatically needs a contact address in
  the client name (a project address like data@mantamarkets.com, not a personal one). Their
  calendars and stated times suffice for timing, so this can wait.
- Any paid feed or licence (Benzinga quote, X API): cost and terms first.
