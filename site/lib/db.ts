// Postgres connection for the tracker (docs/milestone-3-tracker.md). DATABASE_URL here is the
// read-only `manta_site` login, never the admin one: the site can't change data.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (locally: site/.env.local)");

// prepare: false, because Supabase's transaction pooler (what serverless hosts use) hands each
// query to whichever server connection is free, and prepared statements live on one connection.
export const sql = postgres(url, { prepare: false, max: 3 });
