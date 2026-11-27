# Postgres on the VM (moved off Supabase 2026-11-27)

Postgres 17 (Postgres's own apt repository; Ubuntu 24.04 ships only 16) listens on localhost.
The site reaches it only through PgBouncer on `<vm-ip>:6432`: TLS required, scram-sha-256,
transaction pooling, and only the three site logins. The jobs connect over the local Unix socket.

| Login | Used by | May |
|---|---|---|
| `postgres` | admin, `sudo -u postgres psql` on the VM only (peer) | everything |
| `manta_job` | pricing jobs (`/etc/manta/db.env`) | owns the `manta` database and schema |
| `manta_site` | site pages and API (`DATABASE_URL`) | read market data |
| `manta_account` | site accounts (`ACCOUNT_DATABASE_URL`) | own rows only (row-level security) |
| `manta_signup` | retired waitlist | insert an email |

Files in this folder are the live config:
`postgresql-manta.conf` → `/etc/postgresql/17/main/conf.d/manta.conf`,
`pg_hba.conf` → `/etc/postgresql/17/main/pg_hba.conf`, `pgbouncer.ini` → `/etc/pgbouncer/pgbouncer.ini`.

Setup, as run on 2026-11-27 (as root):

```sh
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-17 pgbouncer
# copy the three config files above, then: systemctl restart postgresql@17-main
# roles: create role <login> login password '…' for each login in the table (site passwords
# from the repo-root .env, manta_job's generated and kept in /etc/manta/db.env), then
#   create database manta owner manta_job;  \c manta  revoke all on schema public from public;
# data: pg_dump -n manta --no-owner --no-privileges -Fc from Supabase, pg_restore as manta_job,
#   then psql -f db/schema.sql as manta_job (the grants and policies).
# PgBouncer's certificate (the site pins it: it is public, the key never leaves the VM):
cd /etc/pgbouncer
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -subj /CN=manta-db -addext "subjectAltName=IP:<vm-ip>" -keyout server.key -out server.crt
chown postgres:postgres server.*; chmod 600 server.key
# userlist.txt: the SCRAM verifiers of the three site logins. Rerun after any password change.
sudo -u postgres psql -d manta -At -c "select format('\"%s\" \"%s\"', rolname, rolpassword)
  from pg_authid where rolname in ('manta_site','manta_account','manta_signup') order by 1" \
  > userlist.txt
chown postgres:postgres userlist.txt; chmod 640 userlist.txt; systemctl restart pgbouncer
ufw allow 6432/tcp comment "manta site database (PgBouncer, TLS only)"
```

Check row-level security after any change to roles or policies:
`sudo -u postgres psql -d manta -v ON_ERROR_STOP=1 -f db/rls-check.sql` (ends "all passed").
