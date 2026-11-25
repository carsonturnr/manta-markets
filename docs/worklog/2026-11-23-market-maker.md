# Market maker (step 14): plan and measurements 1–3

## What
- docs/plan-market-maker.md: plan (approved 2026-11-24 with two changes), results of
  measurements 1–4 on six days, and draft quoting rules for approval (sub-step 4).
- `manta-queue` (queue, fills, markouts per day type; `--out` totals, `manta-queue-report`
  pools days; `--mids` a 1 s mid grid) and `manta-fair-predict` (fair value vs next move);
  17 hand-worked tests.
- Latency from series-1: REST round trip to Kalshi 112 ms median, 117 ms p90.
- KXBTCD: back-of-queue orders fill within 60 s 10.5–13.2%, and lose 0.7–1.3¢ per contract
  filled; the incumbent makers' trades net about −0.1¢. Fair value closes 1–3% of its gap.

## Why
- Step 14 is designed from measurements; Carson asked for 5+ days incl. weekend and volatile.

## Decisions
- Days streamed from the Storage Box via series-1 (Mac disk too small), never stored.
- Trades matched to book changes within 1 s; markout spread measured against the mid 1 s
  before the trade, since Kalshi's book change often arrives first.
- REST timed with cache-busting: Kalshi's API is behind a CDN that caches public GETs.
- Holes in the data close orders and markouts (censored), never count as unfilled.

## Follow-ups
- Carson to approve the quoting rules (sub-step 4); then the Nautilus fill check.
- 4.4 of 144 hours lost when the Mac slept mid-download (listed in the plan).
- Pricing has no KXBTC15M model; Kalshi demo keys needed at sub-step 7.
