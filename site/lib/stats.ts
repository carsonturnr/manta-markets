// Statistics for the /stats page (docs/milestone-3-tracker.md, pages 3–5). Cached for 2 minutes:
// they change slowly, and each reads the whole quotes table. Like lib/queries.ts, they run per
// request only (the page awaits connection() first).
import { cacheLife } from "next/cache";
import { sql } from "./db";

const STATS = { stale: 60, revalidate: 120, expire: 240 };

export type GapRow = {
  bucket: string;
  n: number;
  outside: number; // share of snapshots where fair is outside Kalshi's bid–ask
  by: number | null; // when outside, how far past the bid or ask, in probability
  absGap: number; // mean |fair − mid|
};

// Built per call, not shared at module level: a postgres.js fragment is a Promise, and Next's
// "use cache" can deadlock on a Promise created outside the cached function.
const gapCols = () => sql`
  count(*)::int as n,
  avg((fair < yes_bid or fair > yes_ask)::int)::float as outside,
  avg(case when fair > yes_ask then fair - yes_ask when fair < yes_bid then yes_bid - fair end)
    as by,
  avg(abs(fair - (yes_bid + yes_ask) / 2)) as "absGap"`;

/** How often and how far fair value sits outside Kalshi's bid–ask, by time left to the close. */
export async function gapsByHorizon(): Promise<GapRow[]> {
  "use cache";
  cacheLife(STATS);
  const rows = await sql<GapRow[]>`
    with x as (
      select q.*, extract(epoch from c.close_time - q.ts) / 3600 as h
      from manta.quotes q join manta.contracts c using (ticker)
      where q.fair is not null
    )
    select case when h < 1 then 'under 1 h' when h < 3 then '1–3 h' when h < 6 then '3–6 h'
                when h < 24 then '6–24 h' else '24–48 h' end as bucket, ${gapCols()}
    from x group by 1 order by min(h)`;
  return [...rows]; // a plain array: "use cache" must serialize the result
}

/** The same, by hour of the day (UTC) the snapshot was taken. */
export async function gapsByHour(): Promise<GapRow[]> {
  "use cache";
  cacheLife(STATS);
  const rows = await sql<GapRow[]>`
    select lpad(extract(hour from ts)::int::text, 2, '0') || ':00' as bucket, ${gapCols()}
    from manta.quotes where fair is not null
    group by 1 order by 1`;
  return [...rows]; // a plain array: "use cache" must serialize the result
}

// One prediction per settled contract at each of these times before its close. Minute-by-minute
// rows of one contract are nearly the same prediction, so counting them all would overstate how
// much evidence there is.
const predictions = () => sql`
  with h(m) as (values (5), (15), (30), (60)),
  p as (
    select distinct on (c.ticker, h.m)
      c.ticker, c.event_ticker, h.m, (q.yes_bid + q.yes_ask) / 2 as mid, q.fair,
      (c.result = 'yes')::int as y
    from manta.contracts c
    cross join h
    join manta.quotes q on q.ticker = c.ticker
      and q.ts between c.close_time - (h.m + 1) * interval '1 minute'
                   and c.close_time - (h.m - 1) * interval '1 minute'
    where c.result is not null and q.fair is not null
    order by c.ticker, h.m,
      abs(extract(epoch from q.ts - (c.close_time - h.m * interval '1 minute')))
  )`;

export type BrierRow = {
  minutes: number;
  contracts: number;
  events: number;
  kalshi: number; // Brier score of Kalshi's mid
  fair: number; // Brier score of our fair value
};

/** Brier score (mean squared error of the probability against the 0/1 result; lower is better)
 *  for Kalshi's mid and for our fair value, at each time before the close. */
export async function brier(): Promise<BrierRow[]> {
  "use cache";
  cacheLife(STATS);
  const rows = await sql<BrierRow[]>`
    ${predictions()}
    select m as minutes, count(*)::int as contracts, count(distinct event_ticker)::int as events,
           avg((mid - y) ^ 2) as kalshi, avg((fair - y) ^ 2) as fair
    from p group by m order by m`;
  return [...rows]; // a plain array: "use cache" must serialize the result
}

export type CalRow = {
  bucket: number; // 0 = 0–10¢, …, 9 = 90–100¢
  kalshiN: number;
  kalshiPred: number | null;
  kalshiHit: number | null;
  fairN: number;
  fairPred: number | null;
  fairHit: number | null;
};

/** Calibration: group predictions into 10¢ buckets and compare the average prediction with how
 *  often those contracts actually paid out. A well-calibrated price pays out 25% of the time when
 *  it says 25¢. All four times before the close are pooled. */
export async function calibration(): Promise<{ rows: CalRow[]; events: number }> {
  "use cache";
  cacheLife(STATS);
  const rows = await sql<CalRow[]>`
    ${predictions()},
    k as (select least(floor(mid * 10), 9)::int as b, count(*)::int as n, avg(mid) as pred,
                 avg(y::float) as hit from p group by 1),
    f as (select least(floor(fair * 10), 9)::int as b, count(*)::int as n, avg(fair) as pred,
                 avg(y::float) as hit from p group by 1)
    select b as bucket,
           coalesce(k.n, 0) as "kalshiN", k.pred as "kalshiPred", k.hit as "kalshiHit",
           coalesce(f.n, 0) as "fairN", f.pred as "fairPred", f.hit as "fairHit"
    from generate_series(0, 9) b left join k using (b) left join f using (b)
    order by b`;
  const [{ events }] = await sql`
    ${predictions()} select count(distinct event_ticker)::int as events from p`;
  return { rows: [...rows], events };
}

export type BasisRow = {
  close: number; // unix ms
  settlement: number;
  index: number | null; // Deribit index around the close
  coinbase: number | null;
};

/** Kalshi's settlement value (the 60-second BRTI average) against the Deribit index and Coinbase,
 *  each averaged over the snapshots at the start and end of that 60 seconds. */
export async function basis(): Promise<BasisRow[]> {
  "use cache";
  cacheLife(STATS);
  const rows = await sql<BasisRow[]>`
    with e as (
      select event_ticker, close_time, max(settlement_value) as settlement
      from manta.contracts where settlement_value is not null group by 1, 2
    )
    select extract(epoch from e.close_time) * 1000 as close, e.settlement,
           avg(r.deribit_index) as index, avg(r.coinbase) as coinbase
    from e left join manta.runs r
      on r.ts between e.close_time - interval '70 seconds' and e.close_time + interval '10 seconds'
    group by e.close_time, e.settlement order by e.close_time desc`;
  return rows.map((r) => ({ ...r, close: Number(r.close) }));
}
