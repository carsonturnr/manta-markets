// Postgres connection for the tracker (docs/milestone-3-tracker.md). DATABASE_URL here is the
// read-only `manta_site` login, never the admin one: the site can't change data.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (locally: site/.env.local)");

// The database is Postgres on the VM, behind PgBouncer in transaction mode (infra/deploy/db/setup.md;
// moved off Supabase 2026-11-27). PgBouncer holds a database connection only for one transaction,
// so a Vercel function frozen with an idle connection no longer keeps a database slot (on
// 2026-11-26 idle site connections held all 15 of Supabase's). Its prepared-statement tracking
// lets postgres.js send several queries down one connection without waiting ("pipelining"): 40 at
// once over 3 connections all answered (2026-11-27), where Supabase's transaction pooler hung the
// /stats page (2026-11-13). Each server instance still keeps at most 3, closed after 5 idle seconds.
//
// PgBouncer's certificate is self-signed on the VM; DATABASE_CA is that certificate (PEM) and the
// only one trusted, as RELAY_CA is for the relay (lib/vm.ts). Unset, the URL's own sslmode applies
// (a local database).
export const ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : undefined;
export const sql = postgres(url, { max: 3, idle_timeout: 5, ssl });
