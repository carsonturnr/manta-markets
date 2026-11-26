// Postgres connection for the tracker (docs/milestone-3-tracker.md). DATABASE_URL here is the
// read-only `manta_site` login, never the admin one: the site can't change data.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (locally: site/.env.local)");

// DATABASE_URL must be Supabase's *session* pooler (port 5432), not the transaction pooler (6543).
// When more queries are in flight than connections, postgres.js sends several down one
// connection without waiting for each answer ("pipelining"), and through the transaction pooler
// those queries never get an answer: the /stats page hung forever (measured 2026-11-13). Session
// mode holds a real database connection per client connection (about 15 on the free tier), so
// each server instance keeps at most 3. Idle ones close after 5 seconds (was 20): Vercel freezes a
// function after it answers, so its open connections keep their pool slots until it next wakes,
// and on 2026-11-26 all 15 slots were held by idle site connections (the oldest 1 h 42 min) while
// pages failed with "max clients reached". A short idle time hands slots back before the freeze.
if (url.includes(":6543/")) throw new Error("DATABASE_URL: use the session pooler (5432)");
export const sql = postgres(url, { max: 3, idle_timeout: 5 });
