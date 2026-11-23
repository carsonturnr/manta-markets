// Event response (docs/product.md, tool 15): how contracts still trading moved around a scheduled
// economic release. The VM computes one JSON file per release (recorder/cmd/eventresponse) next to
// the replay files; replayserve hands them to this server with the replay's token. Read at request
// time only, like lib/replay.ts. No next/cache import, so node's test runner can load this file.
import { fetchReplay } from "./replayserve.ts";

/** One contract's reaction. Every measured field is null when it is undefined (no book, no move). */
export type Reaction = {
  venue: string;
  ticker: string;
  event: string;
  mids: [number, number][]; // [unix ms, mid in cents], t0 − 15 min to t0 + 30 min
  move_cents: number | null;
  time_to_90_ms: number | null;
  depth_10m_before: number | null; // contracts resting within 2¢ of the mid
  depth_30s_before: number | null;
  spread_t0_cents: number | null;
  spread_usual_cents: number | null; // median spread, t0 − 15 min to t0 − 1 min
  changes: number; // book changes seen in the window: the sample size
};

export type Release = {
  release: string; // date and kind: 2026-12-04-payrolls
  name: string;
  t0: number; // release time, unix ms
  standin: boolean; // a test run on a moment that is not a release
  clock: { vm_offset_us: number; bound_ms: number; time_source: string };
  contracts: Reaction[];
};

// The only names replayserve accepts; checked here too so a URL never reaches it unchecked.
export const RELEASE_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

export async function getRelease(id: string): Promise<Release | null> {
  "use cache"; // the default profile: refreshed every 15 minutes, enough for a file a release
  if (!RELEASE_ID.test(id)) return null;
  try {
    return (await (await fetchReplay(`/events/${id}.json`)).json()) as Release;
  } catch (e) {
    if (String(e).endsWith(": 404")) return null;
    throw e;
  }
}

/** Every release, newest first. shortcut: fetches each whole file for the list (three in
 * December); add a summary endpoint to replayserve if the list grows past a few dozen. */
export async function getReleases(): Promise<Release[]> {
  "use cache";
  const ids = (await (await fetchReplay("/events")).json()) as string[];
  const all = await Promise.all(ids.map(getRelease));
  return all.filter((r) => r !== null).sort((a, b) => b.t0 - a.t0);
}

/** Largest move first, either direction; contracts with no move last. */
export const byMove = (cs: Reaction[]) =>
  [...cs].sort((a, b) => (b.move_cents === null ? -1 : Math.abs(b.move_cents)) - (a.move_cents === null ? -1 : Math.abs(a.move_cents)));

/** Contracts worth a chart: moved at least 1¢, Kalshi's smallest price step. */
export const reacting = (cs: Reaction[]) =>
  byMove(cs).filter((c) => c.move_cents !== null && Math.abs(c.move_cents) >= 1);

/** A figure, or "n/a" when the release file has none. */
export const na = (x: number | null, f: (x: number) => string) => (x === null ? "n/a" : f(x));

export const cents = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}¢`;
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const qty = (n: number) => Math.round(n).toLocaleString("en-US");

/** Book thinning: "1,000 → 120 (−88%)", depth 10 min before against 30 s before. */
export function thinning(before10m: number | null, before30s: number | null): string {
  if (before10m === null || before30s === null) return "n/a";
  if (before10m === 0) return `0 → ${qty(before30s)}`;
  const pct = Math.round((before30s / before10m - 1) * 100);
  return `${qty(before10m)} → ${qty(before30s)} (${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%)`;
}

/** "Dec 4, 08:30 ET": New York time, which the release calendars use (EST or EDT as it falls). */
export function et(ms: number): string {
  const d = new Date(ms);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  return `${md}, ${hm} ET`;
}
