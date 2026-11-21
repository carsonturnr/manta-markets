// Watchlists and alerts (step 11): reads and writes for one signed-in user. Server code only.
//
// It connects as manta_account, which can touch manta.watchlist, manta.alerts and manta.alert_log
// and nothing else (db/schema.sql). Every query runs inside asUser(): a transaction that first
// tells Postgres who the user is (the setting manta.user_id, for that transaction only), and
// row-level security then shows and accepts only that user's rows. The user id comes from
// Clerk's session on the server (auth()), never from the browser.
//
// Not a "use server" file: those turn every exported function into an endpoint anyone can call.
// The form actions are in lib/accountActions.ts and check the session before calling these.
import postgres from "postgres";
import type { Kind } from "./alerts";
import { sql } from "./db";

const url = process.env.ACCOUNT_DATABASE_URL;
// The same session-pooler rule as lib/db.ts.
const db = url && !url.includes(":6543/") ? postgres(url, { max: 2, idle_timeout: 20 }) : null;

export const MAX_WATCHED = 200;
export const MAX_ALERTS = 50;

/** Runs `work` as `userId`: row-level security limits it to that user's rows. */
export async function asUser<T>(
  userId: string,
  work: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  if (!db) throw new Error("ACCOUNT_DATABASE_URL is not set (locally: site/.env.local)");
  return (await db.begin(async (tx) => {
    await tx`select set_config('manta.user_id', ${userId}, true)`;
    return work(tx as unknown as postgres.Sql);
  })) as T;
}

export type Watched = { venue: string; id: string; added: number };

export type Alert = {
  alertId: number;
  venue: string;
  id: string;
  kind: Kind;
  threshold: number;
  created: number;
  met: boolean;
  fired: number | null;
  ended: number | null;
};

export type Fired = { alertId: number; ts: number; value: number | null; emailed: boolean };

const ms = (t: Date | null) => (t === null ? null : t.getTime());

export async function getWatchlist(userId: string): Promise<Watched[]> {
  const rows = await asUser(
    userId,
    (tx) => tx`select venue, id, added from manta.watchlist order by added desc`,
  );
  return rows.map((r) => ({ venue: r.venue, id: r.id, added: r.added.getTime() }));
}

export async function isWatched(userId: string, venue: string, id: string): Promise<boolean> {
  const rows = await asUser(
    userId,
    (tx) => tx`select 1 from manta.watchlist where venue = ${venue} and id = ${id}`,
  );
  return rows.length > 0;
}

/** The user's alerts, newest first; only one contract's if `venue` and `id` are given. */
export async function getAlerts(userId: string, venue?: string, id?: string): Promise<Alert[]> {
  const rows = await asUser(
    userId,
    (tx) => tx`
      select alert_id, venue, id, kind, threshold, created, met, fired, ended
      from manta.alerts
      where ${venue === undefined ? tx`true` : tx`venue = ${venue} and id = ${id ?? ""}`}
      order by created desc`,
  );
  return rows.map((r) => ({
    alertId: Number(r.alert_id),
    venue: r.venue,
    id: r.id,
    kind: r.kind,
    threshold: r.threshold,
    created: r.created.getTime(),
    met: r.met,
    fired: ms(r.fired),
    ended: ms(r.ended),
  }));
}

/** The last 20 times the user's alerts fired. */
export async function getFired(userId: string): Promise<Fired[]> {
  const rows = await asUser(
    userId,
    (tx) => tx`
      select alert_id, ts, value, emailed from manta.alert_log order by ts desc limit 20`,
  );
  return rows.map((r) => ({
    alertId: Number(r.alert_id),
    ts: r.ts.getTime(),
    value: r.value,
    emailed: r.emailed,
  }));
}

/** Whether this contract is one whole side of a cross-venue pair (manta.pairs): then a
 * "venues" alert can compare it with the other venue. Read with the site's read-only login. */
export async function isPaired(venue: string, id: string): Promise<boolean> {
  const rows =
    venue === "kalshi"
      ? await sql`select 1 from manta.pairs where kalshi_ids = array[${id}]::text[] limit 1`
      : await sql`select 1 from manta.pairs where poly_ids = array[${id}]::text[] limit 1`;
  return rows.length > 0;
}

export type Listed = {
  venue: string;
  id: string;
  family: string;
  event: string;
  payoff: string;
  low: number | null;
  high: number | null;
  inclusive: boolean;
  label: string;
  bid: number | null;
  ask: number | null;
  fair: number | null;
  close: number;
};

/** The listed ones among these contracts, keyed "venue:id" (manta.markets, read-only login).
 * A contract missing from the map has closed. */
export async function getListed(keys: string[]): Promise<Map<string, Listed>> {
  if (keys.length === 0) return new Map();
  const rows = await sql`
    select venue, id, family, event, payoff, low, high, inclusive, label, bid, ask, fair,
           extract(epoch from close_time) * 1000 as close
    from manta.markets
    where venue || ':' || id = any(${keys})`;
  return new Map(
    rows.map((r) => [`${r.venue}:${r.id}`, { ...r, close: Number(r.close) } as unknown as Listed]),
  );
}
