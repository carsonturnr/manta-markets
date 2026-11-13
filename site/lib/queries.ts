// Every database read the site makes. Each is cached for 30 seconds: the snapshotter writes once a
// minute, so fresher reads would only add load. An expiry under 5 minutes also keeps Next from
// running these at build time (they become request-time "dynamic holes" behind <Suspense>).
import { cacheLife } from "next/cache";
import { sql } from "./db";

const LIVE = { stale: 30, revalidate: 30, expire: 120 };

export type Contract = {
  ticker: string;
  series: "KXBTCD" | "KXBTC";
  strikeType: "greater" | "less" | "between";
  floor: number | null;
  cap: number | null;
  close: number; // unix ms
  result: "yes" | "no" | null;
  settlement: number | null;
};

export type Quote = Contract & { bid: number; ask: number; fair: number | null };

export type Board = {
  at: number; // unix ms of the latest snapshot
  ageS: number; // its age when read (up to 30 s more by the time it's shown, from the cache)
  index: number;
  coinbase: number | null;
  quotes: Quote[];
};

// Columns shared by every contract query, renamed to the TypeScript shape.
const contractCols = sql`
  c.ticker, c.series, c.strike_type as "strikeType", c.floor_strike as floor, c.cap_strike as cap,
  extract(epoch from c.close_time) * 1000 as close, c.result, c.settlement_value as settlement`;

/** The latest snapshot: every contract in play with Kalshi's bid/ask and our fair value. */
export async function getBoard(): Promise<Board | null> {
  "use cache";
  cacheLife(LIVE);
  const [run] = await sql`
    select extract(epoch from ts) * 1000 as at, extract(epoch from now() - ts) as age_s,
           deribit_index, coinbase
    from manta.runs order by ts desc limit 1`;
  if (!run) return null;
  // Each open contract's latest quote. Not only the latest run's: contracts more than 6 hours
  // from their close are snapshotted every 5 minutes, so look back 6 minutes.
  const quotes = await sql<Quote[]>`
    with latest as (select max(ts) as ts from manta.runs),
    recent as (
      select distinct on (q.ticker) q.*
      from manta.quotes q, latest
      where q.ts > latest.ts - interval '6 minutes'
      order by q.ticker, q.ts desc
    )
    select ${contractCols}, r.yes_bid as bid, r.yes_ask as ask, r.fair
    from recent r join manta.contracts c using (ticker), latest
    where c.close_time > latest.ts
    order by c.close_time, coalesce(c.floor_strike, c.cap_strike)`;
  return {
    at: Number(run.at),
    ageS: Number(run.age_s),
    index: run.deribit_index,
    coinbase: run.coinbase,
    quotes: quotes.map((q) => ({ ...q, close: Number(q.close) })),
  };
}

export type Point = { t: number; bid: number; ask: number; fair: number | null; index: number };

/** One contract and its minute-by-minute history. */
export async function getContract(
  ticker: string,
): Promise<{ contract: Contract; points: Point[] } | null> {
  "use cache";
  cacheLife(LIVE);
  const [contract] = await sql<Contract[]>`
    select ${contractCols} from manta.contracts c where c.ticker = ${ticker}`;
  if (!contract) return null;
  const points = await sql<Point[]>`
    select extract(epoch from q.ts) * 1000 as t, q.yes_bid as bid, q.yes_ask as ask, q.fair,
           r.deribit_index as index
    from manta.quotes q join manta.runs r using (ts)
    where q.ticker = ${ticker}
    order by q.ts`;
  return {
    contract: { ...contract, close: Number(contract.close) },
    points: points.map((p) => ({ ...p, t: Number(p.t) })),
  };
}
