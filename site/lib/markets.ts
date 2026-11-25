// The Markets page's filters (/markets, and the home page's busiest markets): a category or
// "Closing today", a text search, and an order. Pure, so it is tested without a database.
import type { Event } from "./events.ts";
import { FAMILIES } from "./families.ts";

export const FILTERS = ["All", "Crypto", "Economics", "Financials", "Closing today"] as const;
export type Filter = (typeof FILTERS)[number];

export const SORTS = { volume: "Most traded", close: "Closing soonest" } as const;
export type Sort = keyof typeof SORTS;

const FAMILY_NAME = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.name]));

/** The events in a filter; "Closing today" means within the next 24 hours. */
export function pick(events: Event[], f: Filter, now: number): Event[] {
  if (f === "All") return events;
  if (f === "Closing today") return events.filter((e) => e.close - now < 86_400_000);
  return events.filter((e) => e.category === f);
}

/** Events whose question, family name, venue, ticker or an outcome's name contains every word of
 * `q` (case ignored), so "fed december" and "bitcoin 5 pm" both find their event. */
export function search(events: Event[], q: string): Event[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return events;
  return events.filter((e) => {
    const text = [
      e.question,
      FAMILY_NAME.get(`${e.venue}/${e.family}`) ?? "",
      e.venue,
      e.event,
      ...e.outcomes.map((o) => o.label),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Most traded first (in dollars where the venue counts contracts, so venues compare), or
 * closing soonest first. */
export function order(events: Event[], s: Sort): Event[] {
  if (s === "close") return [...events].sort((a, b) => a.close - b.close);
  const dollars = (e: Event) =>
    e.volumeUnit === "usd"
      ? e.volume
      : e.outcomes.reduce((n, o) => n + o.volume * (((o.bid ?? 0) + (o.ask ?? 0)) / 2), 0);
  return [...events].sort((a, b) => dollars(b) - dollars(a));
}
