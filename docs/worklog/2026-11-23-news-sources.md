# 2026-11-23 news-sources

## What
- docs/news-sources.md: a one-page comparison of sources for timestamping market-moving news on the order books' clock (tool 16, build order 13c): BLS, BEA, the Fed, Treasury and DOL, then five wires (Alpaca, Benzinga, Massive, Finnhub, Tiingo) plus the X API and enterprise wires for contrast.
- Measured, from a development Mac: stated time → page written for 17 Fed press releases (median 23 s), 14 speeches (17 s) and 58 Treasury auction results (146 s); live first receipt of a Treasury press release (93 s at 60 s polling) and the 2-year note result (file 167 s, JSON API ~240 s).
- A dated line in docs/decisions.md.

## Why
Carson approved the event-response work (tools 15–16); the plan asks for a source comparison with measured delays before any news code or paid feed.

## Decisions
- Carson approved the recommendation on 2026-11-23 and asked to merge without waiting for Wednesday's measurements.
- Recommend official sources only: scheduled events are timed by their stated time from the official calendars; unscheduled official news polled from the VM (Fed RSS, Treasury press page, auction result XML). Free, and public domain, so the text can be shown.
- No paid wire: none of the affordable ones lets a public commercial site show headlines (Alpaca, Finnhub, Tiingo forbid it; Benzinga by contract).
- Measurements used the pages' Last-Modified headers as well as live polling, because one day of live polling gives few samples.

## Follow-ups
- Live measurements still due: BEA GDP + PCE and Beige Book (Wed 25 Nov), Fed H.15/H.10 (today 21:15 UTC). The scratchpad poller runs until Wed 19:30 UTC.
- BLS and DOL: Carson approved data@mantamarkets.com in the client name (works, checked); Carson to add a data@ forward at Namecheap.
- A poller bug missed today's bill results and the guessed 2-year XML (fixed for later windows).
- Not checked: X's developer terms, Benzinga's direct price, the Fed's current lock-up.
