// Implied distributions (docs/product.md, step 7): one row per ladder event, replaced every
// minute by the VM's minute job (pricing/distribution.py, where the method is explained).
import { cacheLife } from "next/cache";
import { sql } from "./db";

export type Dist = {
  venue: string; // kalshi, polymarket, or both
  family: string;
  event: string;
  title: string;
  close: number; // ms
  method: string;
  curve: [number, number][]; // (x, P(value > x))
  median: number | null;
  q25: number | null;
  q75: number | null;
  mean: number | null;
  sd: number | null;
  vol: number | null;
  deribitVol: number | null;
  spread: number | null;
  updated: number; // ms
};

export async function getDistributions(): Promise<Dist[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  const rows = await sql`
    select venue, family, event, title, extract(epoch from close_time) * 1000 as close, method,
           curve, median, q25, q75, mean, sd, vol, deribit_vol as "deribitVol", spread,
           extract(epoch from updated) * 1000 as updated
    from manta.distributions
    order by close_time`;
  return rows.map((r) => ({ ...r, close: Number(r.close), updated: Number(r.updated) }) as Dist);
}

export { expects, fmtValue, onWhat, underlying, UNDERLYINGS } from "./units";

/** A key for one distribution in the URL: venue and event (crypto events exist per venue). */
export const distKey = (d: Pick<Dist, "venue" | "event">) => `${d.venue}/${d.event}`;
