// Events: a venue's contracts on one question ("Bitcoin at 5 pm ET today", "the Fed in December"),
// grouped from the screener's listing (manta.markets, replaced every minute on the VM). Read-only.
import { cacheLife } from "next/cache";
import { sql } from "./db";
import { type Category, FAMILIES } from "./families";
import { mid, question } from "./outcomes";
import { type Row, rowCols } from "./screener";

export type Event = {
  venue: "kalshi" | "polymarket";
  event: string;
  family: string;
  category: Category;
  question: string;
  close: number; // unix ms, the earliest close among its contracts
  volume: number; // the contracts' 24-hour volumes added up, in the venue's unit
  volumeUnit: "contracts" | "usd";
  outcomes: Row[]; // two-sided contracts only, likeliest first
};

const CATEGORY = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.category]));

/** Every open event with at least one contract quoted on both sides, busiest first, and when the
 * listing was read. */
export async function getEvents(): Promise<{ events: Event[]; at: number | null }> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  const rows = (await sql`
    select ${rowCols()}
    from manta.markets
    where bid is not null and ask is not null`) as unknown as Row[];
  const [run] = await sql`select extract(epoch from max(updated)) * 1000 as at from manta.markets`;
  const at = run?.at == null ? null : Number(run.at);
  return { events: group(rows.map((r) => ({ ...r, close: Number(r.close) })), at ?? Date.now()), at };
}

/** One event, or null if it has no two-sided contract open. */
export async function getEvent(venue: string, event: string): Promise<Event | null> {
  const { events } = await getEvents();
  return events.find((e) => e.venue === venue && e.event === event) ?? null;
}

function group(rows: Row[], now: number): Event[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.venue}/${r.event}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()]
    .map((os) => {
      const first = os[0];
      const close = Math.min(...os.map((o) => o.close));
      return {
        venue: first.venue,
        event: first.event,
        family: first.family,
        category: CATEGORY.get(`${first.venue}/${first.family}`) ?? "Crypto",
        question: question(first.family, os, close, now),
        close,
        volume: os.reduce((s, o) => s + o.volume, 0),
        volumeUnit: first.volumeUnit,
        outcomes: [...os].sort((a, b) => (mid(b) ?? 0) - (mid(a) ?? 0)),
      };
    })
    .sort((a, b) => b.volume - a.volume);
}
