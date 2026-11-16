// Liquidity samples (docs/product.md, step 6b): one row per family every 15 minutes, written by
// the VM's minute job (pricing/liquidity.py). Spread and size are medians over "active" contracts:
// quoted on both sides, midpoint from 5¢ to 95¢.
import { cacheLife } from "next/cache";
import { sql } from "./db";

export type Now = {
  venue: string;
  family: string;
  contracts: number;
  active: number;
  spread: number | null;
  size: number | null;
};

export type HourCell = { venue: string; family: string; hour: number; spread: number; n: number };

export async function getLiquidity(): Promise<{
  now: Now[];
  at: number | null;
  hours: HourCell[];
  since: number | null;
  samples: number;
}> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 900 });
  const now = await sql<Now[]>`
    select venue, family, contracts, active, spread, size from manta.liquidity
    where ts = (select max(ts) from manta.liquidity)
    order by venue, family`;
  // Median spread per family and hour of day (UTC), over the last 14 days.
  const hours = await sql`
    select venue, family, extract(hour from ts)::int as hour,
           percentile_cont(0.5) within group (order by spread) as spread, count(*)::int as n
    from manta.liquidity
    where ts > now() - interval '14 days' and spread is not null
    group by 1, 2, 3`;
  const [meta] = await sql`
    select extract(epoch from min(ts)) * 1000 as since, extract(epoch from max(ts)) * 1000 as at,
           count(distinct ts)::int as samples
    from manta.liquidity`;
  return {
    now,
    at: meta?.at == null ? null : Number(meta.at),
    hours: hours.map((h) => ({ ...h, spread: Number(h.spread) }) as HourCell),
    since: meta?.since == null ? null : Number(meta.since),
    samples: meta?.samples ?? 0,
  };
}
