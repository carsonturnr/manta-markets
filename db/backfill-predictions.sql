-- One-time backfill of manta.predictions (step 9) from the tracker's Kalshi Bitcoin history
-- (manta.quotes, manta.contracts), so the accuracy page starts with the closes recorded before
-- predictions were stored. Run once, after schema.sql: psql "$DATABASE_URL" -f this file.
--
-- Same rules as pricing/accuracy.py: one prediction per contract and horizon, the first quote
-- within a tenth of the horizon (at least a minute) before the close, quoted on both sides (the
-- tracker writes a missing bid as 0 and a missing ask as 1). From 2026-11-13 23:45 UTC: before
-- that, Kalshi's quotes came from its market list, which trails the order book.
-- The tracker kept only contracts its mid or fair value put between 3¢ and 97¢.
insert into manta.predictions
    (venue, id, family, event, horizon, ts, decided, bid, ask, fair, fair_method, result)
select distinct on (c.ticker, h.m)
    'kalshi', c.ticker, c.series, c.event_ticker, h.m, q.ts, c.close_time, q.yes_bid, q.yes_ask,
    q.fair, case when q.fair is not null then 'options' end, (c.result = 'yes')::int
from manta.contracts c
cross join (values (5), (60), (1440)) h(m)
join manta.quotes q on q.ticker = c.ticker
    and q.ts >= c.close_time - h.m * interval '1 minute'
    and q.ts < c.close_time - (h.m - greatest(1, h.m / 10.0)) * interval '1 minute'
where c.result is not null and q.ts >= '2026-11-13 23:45:00+00'
    and q.yes_bid > 0 and q.yes_ask < 1
order by c.ticker, h.m, q.ts
on conflict do nothing;
