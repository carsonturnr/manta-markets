# Plan: news events (tool 16, decided 2026-11-27)

**Demo:** official news (a Fed statement, a Treasury sanction, an auction result, GDP) shown as
a mark on a market's price chart at the second we received it, and a page listing each item
with how the order books moved around it. Sources and measured delays: docs/news-sources.md.

## Words used here
- **Stated time:** when the source says it published (an RSS `pubDate`, an auction's close).
- **Received:** when our collector first saw the item, on the VM's clock (synced, offset published).
- **Receipt delay:** received minus stated: the source's posting delay plus our polling (≤ 15 s).
- **Move:** as in event response: a contract's mid 30 min after t0 minus its mid just before.

## What is collected (all official, public domain, no key, no new dependency)
| Source | URL polled | Every | Why |
|---|---|---|---|
| Fed press releases | federalreserve.gov/feeds/press_all.xml | 15 s | statements, minutes, actions |
| Fed speeches | federalreserve.gov/feeds/speeches.xml | 15 s | governors' remarks |
| Treasury press | home.treasury.gov/news/press-releases (HTML list: link, title, `<time>`) | 15 s | sanctions, statements; no RSS exists |
| Treasury auctions | TreasuryDirect `securities/auctioned` JSON | 15 s | high rate, bid-to-cover |
| BEA | apps.bea.gov/rss/rss.xml | 15 s | GDP, PCE, trade |
| DOL | dol.gov/rss/releases.xml | 15 s at 8:29–8:45 ET weekdays, 5 min otherwise | weekly jobless claims (the only source) |
| BLS | bls.gov/feed/cpi.rss, empsit.rss (Atom) | same as DOL | CPI and payrolls headlines |

BLS and DOL identify as `manta-markets news timing (data@mantamarkets.com)`. Requests are
conditional (ETag / If-Modified-Since); on 403, 429 or any error a feed's interval doubles, up to
5 min, and resets after a success, so we never hammer a site that blocks robots. All answer 200
(checked 2026-11-27). Stated times that are not real: DOL's `pubDate` is 12:00 UTC for a 13:30 UTC
release, BLS's `published` is ~40 min *before* the 8:30 release (staged), Treasury press times can
sit 10 min before posting. Those sources get no "delay vs stated time" of their own; a BLS item at a
releases.tsv release is measured against that release's minute. TreasuryDirect's JSON trails the
per-auction XML by ~70 s; the XML is a follow-up if that matters.

## Where it runs
A new binary, `recorder/cmd/news`, as its own capped systemd service on the VM (`manta-news`), not
inside the recorder: a news change or crash must never restart it and gap the books. Parsers in
`recorder/internal/news`, pure functions tested on saved real feed samples (testdata/).

## Storage (files, no migration)
One JSON line per new item, appended to `/var/lib/manta/replay/news/<UTC day>.jsonl`:
`{source, id, title, url, stated_ms, received_ms, backfill}`. Items already in a feed when the
collector starts are `backfill: true` (no real receipt time) and never enter the delay figures.
Kept 60 days like the replay files. `replayserve` gets one endpoint, `GET /news`: the last 30
days of items, newest first. Same token, same TLS.

**Order-book move around each item** (`news -moves`, changed at step 2 after measuring): a full
event-response run parses every raw Kalshi record of its window (152 s CPU on the Mac, 864 s on the
VM), so instead replay.sh, after each hourly replay, reads the replay files it just wrote (minute
books of all 22 series, ~2 MB an hour): 1.2 s CPU for two items. Move = mid 30 min after t0's
minute minus mid at it; **baseline** = the same contract's move over the 30 min before (on the
2026-11-25 16:30 auction, 411 of 715 contracts moved ≥ 1¢ after, 380 before). Minute resolution.
t0 is the stated time where real (Fed, auctions, BEA), else our receipt time; each move says which.
**No double counting:** an item within 10 min after a releases.tsv release (CPI, payrolls, the
Fed's decision) links to that release's page and gets no move. GDP, PCE and claims are not in
releases.tsv, so they get their own move unless Carson adds them there.

## What the site shows (current style, no redesign)
1. **Market page and terminal chart:** a small mark on the candle chart at each item's received
   time (lightweight-charts markers, already installed); hover shows source, title, stated and
   received time, link to the official page.
2. **Terminal Catalysts panel:** the latest news items under the scheduled calendar.
3. **/insights/news:** every item, newest first: time, source, title (linked), stated, received,
   delay, and the biggest move around it with a link to the full per-item page, which reuses the
   release page's chart and table. Linked from a new Insights question.

## Measured and published honestly
Per source: number of items, median and range of receipt delay, the polling interval, the VM
clock offset, failed polls and backfill excluded; unreliable stated times labelled. Under the
moves, one line: a move timed from our receipt starts after the market may already have reacted.
Event-response caveats apply: small samples; news in the same minute as another item or a
scheduled release is not separated from it.

## Steps, each demoable
1. Parsers and the collector, tests on saved samples. Demo: run locally for an hour; its file.
2. `replayserve /news` and the move runs in replay.sh. Demo: local replayserve, one stand-in move.
3. Site: lib/news.ts, chart marks, Catalysts list, /insights/news. Demo: dev server vs local data.
4. Deploy (Carson's go-ahead): manta-news unit, deploy-replay.sh builds `news`. Then pull request.

**Not in this plan:** paid wires, X, headline sentiment or any "what to trade" signal, a second
calendar (scheduled times stay in releases.tsv), a database table.
