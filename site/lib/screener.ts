// The screener's database reads (docs/product.md, step 2). manta.markets holds every open contract,
// replaced once a minute on the VM (recorder/cmd/contracts, stored by manta-contracts).
import { cacheLife } from "next/cache";
import { sql } from "./db";
import { FAMILIES, type Category } from "./families";

export type Row = {
  venue: "kalshi" | "polymarket";
  id: string;
  family: string;
  event: string;
  title: string;
  label: string; // the venue's own short name: "$74,300 or above", "25 bps decrease"
  payoff: "above" | "below" | "between" | "exact" | "outcome";
  low: number | null;
  high: number | null;
  inclusive: boolean;
  close: number; // unix ms
  bid: number | null; // best "yes" bid, probability
  ask: number | null;
  bidSize: number | null; // contracts
  askSize: number | null;
  last: number | null;
  volume: number;
  volumeUnit: "contracts" | "usd";
  openInterest: number | null;
  fair: number | null; // pricing/fairvalues.py
  fairMethod: "options" | "consensus-2" | "consensus-1" | null;
  feeTaker: number | null; // rate × C × P × (1 − P); lib/cost.ts
  feeMaker: number | null;
};

// manta.markets' columns renamed to Row's shape, shared by every query that returns rows. Built per
// call (see lib/queries.ts): a module-level postgres.js fragment is a Promise shared across caches.
export const rowCols = () => sql`
  venue, id, family, event, title, label, payoff, low, high, inclusive,
  extract(epoch from close_time) * 1000 as close, bid, ask,
  bid_size as "bidSize", ask_size as "askSize", last, volume_24h as volume,
  volume_unit as "volumeUnit", open_interest as "openInterest", fair,
  fair_method as "fairMethod",
  fee_taker as "feeTaker", fee_maker as "feeMaker"`;

export const SORTS = ["close", "volume", "spread", "bid", "ask", "oi", "edge"] as const;
export type Sort = (typeof SORTS)[number];

export type Filters = {
  venue: "" | "kalshi" | "polymarket";
  category: "" | Category;
  family: string; // "" or a family id
  closes: "" | "1h" | "24h" | "7d"; // closes within
  traded: boolean; // traded in the last 24 hours
  oneSided: boolean; // include contracts with no bid or no ask (hidden by default: mostly dead strikes)
  spread: number; // max spread in cents, 0 = any
  q: string; // text in the question, label or ticker
  sort: Sort;
  desc: boolean;
  page: number; // from 0
};

export const PAGE = 100;

const WITHIN = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days" };

/** One page of contracts matching the filters, how many match in all, and the listing's age. */
export async function screen(
  f: Filters,
): Promise<{ rows: Row[]; total: number; at: number | null; ageS: number | null }> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  // Fragments are built per call (see lib/queries.ts). Every value is a bound parameter; the sort
  // column and direction come from fixed lists, never from the URL's text.
  const conds = [sql`true`];
  if (f.venue) conds.push(sql`venue = ${f.venue}`);
  if (f.category) {
    const fams = FAMILIES.filter((x) => x.category === f.category).map((x) => x.family);
    conds.push(sql`family = any(${fams})`);
  }
  if (f.family) conds.push(sql`family = ${f.family}`);
  if (f.closes) conds.push(sql`close_time < now() + ${WITHIN[f.closes]}::interval`);
  if (f.traded) conds.push(sql`volume_24h > 0`);
  if (!f.oneSided) conds.push(sql`bid is not null and ask is not null`);
  if (f.spread) conds.push(sql`ask - bid <= ${f.spread / 100 + 1e-9}`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    conds.push(sql`(title ilike ${like} or label ilike ${like} or id ilike ${like})`);
  }
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);
  const col = {
    close: sql`close_time`,
    volume: sql`volume_24h`,
    spread: sql`ask - bid`,
    bid: sql`bid`,
    ask: sql`ask`,
    oi: sql`open_interest`,
    // How far the fair value is from the midpoint, either way. Not for one-venue consensus,
    // which is fitted to the very quotes it would be compared with.
    edge: sql`case when fair_method <> 'consensus-1' then abs(fair - (bid + ask) / 2) end`,
  }[f.sort];
  const dir = f.desc ? sql`desc` : sql`asc`;

  const rows = await sql`
    select ${rowCols()},
           count(*) over () as total
    from manta.markets
    where ${where}
    order by ${col} ${dir} nulls last, close_time, id
    limit ${PAGE} offset ${f.page * PAGE}`;
  const [run] = await sql`
    select extract(epoch from max(updated)) * 1000 as at,
           extract(epoch from now() - max(updated)) as age_s
    from manta.markets`;
  return {
    rows: rows.map((r) => ({ ...r, close: Number(r.close) }) as unknown as Row),
    total: rows.length ? Number(rows[0].total) : 0,
    at: run?.at == null ? null : Number(run.at),
    ageS: run?.age_s == null ? null : Number(run.age_s),
  };
}

/** One open contract, whether the BTC tracker has its fair-value history, and the listing's
 * time; null if it isn't listed (closed, or never covered). */
export async function getMarket(
  venue: string,
  id: string,
): Promise<{ row: Row; tracked: boolean; at: number } | null> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  const [r] = await sql`
    select ${rowCols()},
           extract(epoch from updated) * 1000 as at,
           exists (select 1 from manta.contracts c where c.ticker = m.id) as tracked
    from manta.markets m
    where venue = ${venue} and id = ${id}`;
  if (!r) return null;
  const { at, tracked, ...row } = r;
  return { row: { ...row, close: Number(row.close) } as unknown as Row, tracked, at: Number(at) };
}

/** Every open contract with a fair value, for the API's /fair-values (lib/api.ts keeps only the
 * fair value and the contract's description). */
export async function getFairValues(): Promise<{ rows: Row[]; at: number | null }> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  const rows = await sql`
    select ${rowCols()} from manta.markets where fair is not null order by close_time, venue, id`;
  const [meta] = await sql`select extract(epoch from max(updated)) * 1000 as at from manta.markets`;
  return {
    rows: rows.map((r) => ({ ...r, close: Number(r.close) }) as unknown as Row),
    at: meta?.at == null ? null : Number(meta.at),
  };
}
