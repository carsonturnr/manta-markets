# News events (tool 16)

## What
- `recorder/cmd/news`: a collector for official news (Fed press and speeches, Treasury press and auction results, BEA, DOL, BLS CPI and payrolls). It appends each new item, stamped with when we received it, to `replay/news/<day>.jsonl`. Parsers are in `recorder/internal/news`, tested on saved real samples.
- `news -moves`, run by replay.sh after each hourly replay: each Kalshi contract's move in the 30 minutes after an item and over the 30 minutes before (the baseline), read from the replay files. replayserve serves `/news` and `/news/moves/<key>.json`.
- Site: `/insights/news` (every item with its receipt delay and after-vs-before move, delay by source, method), `/insights/news/[key]` (charts and table), a fifth Insights question, ▼ news marks on candle charts (only for families the source plausibly moves), and the newest items in the terminal's Catalysts panel.
- `manta-news.service` and deploy-replay.sh lines. **Not deployed.**

## Why
docs/product.md item 16: unscheduled official news on the same clock as the order books. Carson decided to build it on 2026-11-27, with official sources only (docs/news-sources.md).

## Decisions
- Separate binary and unit, not in the recorder: a news crash must never leave gaps in the books.
- Files served by replayserve, as for event response: no migration.
- Moves come from the replay files, not per-item event-response runs (152 s CPU on the Mac, 864 s on the VM, against 1.2 s). The cost is minute resolution and no time-to-90%.
- Baseline and headline: drift alone moves hundreds of hourly contracts (405 after vs 380 before on a quiet auction), so pages lead with after minus before.
- t0 is the stated time where it is a real publication time (Fed, auctions, BEA), else our receipt time, and each move says which. DOL, BLS and Treasury press stated times are not real, so those items publish no delay.
- An item from a release's own agency within 10 min of a releases.tsv release links to that release's page. GDP, PCE and claims are not in releases.tsv, so they get their own move.
- Polling: conditional requests; BLS/DOL fast only 8:29–8:45 ET on weekdays; any error doubles the wait up to 5 min. TreasuryDirect ignores conditional requests, so the poll reads 2 days of results (~5 KB).

## Follow-ups
- Deploy (Carson): `infra/deploy/deploy-replay.sh` installs `news`, enables `manta-news` and restarts replayserve. Then check `journalctl -u manta-news` and `/news`.
- The data@mantamarkets.com forward has not been tested by sending mail (privacy@ was).
- The chart's hover card clips long titles (cut at "transactions").
- "Received after" stays empty until live items arrive. No live item came in while testing (holiday week), so the first real delays come after deploy.
- Auction results from TreasuryDirect's per-auction XML would arrive ~70 s sooner than the JSON.
- Not checked: the 390 px layout of the delay table (it scrolls), and the terminal at phone widths.
- moves.jsonl is never trimmed (~200 B an item); trim it if it passes a few MB.
