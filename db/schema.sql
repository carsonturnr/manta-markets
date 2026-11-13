-- Manta tracker database (docs/milestone-3-tracker.md). Apply with: uv run manta-snap --init
--
-- Tables live in their own schema, not `public`: Supabase exposes `public` through its REST API
-- to anyone with the project's public key. `manta` is reachable only with a database login.

create schema if not exists manta;

-- One row per snapshot (once a minute).
create table if not exists manta.runs (
    ts            timestamptz primary key,
    deribit_index double precision not null,  -- the price our fair values use
    coinbase      double precision,           -- a stand-in for the BRTI Kalshi settles on
    priced        integer not null            -- contracts written this run
);

-- One row per Kalshi contract. Result and settlement value are filled in after the close.
create table if not exists manta.contracts (
    ticker           text primary key,
    -- Bitcoin series only, enforced here as well as in code (no sports markets, ever).
    series           text not null check (series in ('KXBTCD', 'KXBTC')),
    event_ticker     text not null,
    strike_type      text not null check (strike_type in ('greater', 'less', 'between')),
    floor_strike     double precision,
    cap_strike       double precision,
    close_time       timestamptz not null,
    result           text check (result in ('yes', 'no')),
    settlement_value double precision  -- the 60-second BRTI average Kalshi settled on
);
create index if not exists contracts_close_time on manta.contracts (close_time);

-- One row per contract per snapshot. Prices are probabilities (0.42 = 42¢).
create table if not exists manta.quotes (
    ts      timestamptz not null references manta.runs (ts),
    ticker  text not null references manta.contracts (ticker),
    yes_bid double precision not null,
    yes_ask double precision not null,
    fair    double precision,  -- null inside the final 60 seconds (the average is partly known)
    vol     double precision,  -- the volatility used, at the contract's (lower) strike
    primary key (ticker, ts)
);
create index if not exists quotes_ts on manta.quotes (ts);

-- The site's login: read-only on this schema. Its password is set outside git
-- (manta-snap --init sets it from SITE_DB_PASSWORD).
do $$ begin
    if not exists (select from pg_roles where rolname = 'manta_site') then
        create role manta_site login;
    end if;
end $$;
grant usage on schema manta to manta_site;
grant select on all tables in schema manta to manta_site;
alter default privileges in schema manta grant select on tables to manta_site;
