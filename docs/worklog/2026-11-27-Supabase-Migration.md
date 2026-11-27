# 2026-11-27 — Supabase-Migration: the database moves to Postgres on the VM

## What
- Paused the VM jobs that use the database (manta-snap, manta-contracts, manta-quality timers);
  the recorder, archive, replay and news never touch it and kept running.
- Postgres 17 on the VM, localhost only, scram-sha-256, TLS on TCP. PgBouncer on :6432 in front:
  TLS required (self-signed certificate the site pins as `DATABASE_CA`), transaction mode, and
  only the three site logins. Config and setup steps in infra/deploy/db/.
- Roles as on Supabase (manta_site read-only, manta_account with row-level security, manta_signup
  insert-only), plus manta_job, a non-superuser owner for the jobs (`/etc/manta/db.env`).
- Data copied with pg_dump/pg_restore: all 17 tables match row for row. New db/rls-check.sql
  passes (and fails when RLS is switched off, so it can catch a leak).
- Site: the 6543 session-pooler rule is gone; both connections pin PgBouncer's certificate.
  Privacy page: the data is now in Finland (Hetzner), effective 27 November.
- Jobs read the local DATABASE_URL from /etc/manta/db.env; deploy-snap.sh no longer copies the
  Supabase URL. Switched over 2026-11-27 23:35 UTC (PR #26); jobs resumed on the VM.
- Nightly pg_dump + logins to the Storage Box (db-backup.sh, 14 days), restore-tested. The recorder
  email also covers database down and disk over 80% (OPS_EMAIL=ops@mantamarkets.com). README,
  decisions.md, agent-reference.md updated (PR #27).

## Why
The Supabase org used 46 GB of egress against the free tier's 5 GB (grace period ending
2026-11-27), from the per-minute jobs and the site's request-time queries. Hetzner includes 20 TB.

## Decisions
- PgBouncer is the only public port, not Postgres: Vercel has no fixed IPs, so the firewall can't
  narrow it; TLS, scram, three least-privilege logins and no admin/job login from outside instead.
- Self-signed certificate pinned by the site (as the relay does) over Let's Encrypt: no DNS name
  or certbot needed, and only our certificate is trusted.
- Prepared statements stay on (PgBouncer 1.26 `max_prepared_statements`): 40 concurrent queries
  on 3 connections all answered, the case that hung /stats on Supabase's transaction pooler.
- Site passwords kept (48 characters), so Vercel only changed host and certificate.

## Follow-ups
- A Namecheap forward for ops@mantamarkets.com, then one test email. The VM's price in the README
  is from third-party lists; check it against the invoice.
- Repo-root `.env` DATABASE_URL is still Supabase's admin URL (backtest/check.py uses it).
- Pause the Supabase project after a few clean days; delete only when Carson says so.
