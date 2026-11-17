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

-- The recorder's latest data-quality report (recorder/cmd/status -json, stored by manta-quality
-- every 15 minutes): one row, replaced each time. Read by the site's /quality page.
create table if not exists manta.quality (
    id      boolean primary key default true check (id),  -- only ever one row
    updated timestamptz not null,
    report  jsonb not null
);

-- Every open contract Manta covers, for the screener (docs/product.md, step 2): the current state
-- only, replaced every minute by manta-contracts (recorder/cmd/contracts). History is the raw
-- recordings. Prices are probabilities; strikes in the underlying's unit (recorder/internal/contracts).
create table if not exists manta.markets (
    venue         text not null check (venue in ('kalshi', 'polymarket')),
    id            text not null,  -- Kalshi ticker, Polymarket condition id
    -- The allow-lists (recorder/internal/tap), enforced here as well as in code: no sports, ever.
    family        text not null check (family in (
        'KXBTCD', 'KXBTC', 'KXBTC15M', 'KXETHD', 'KXETH', 'KXETH15M',
        'KXFEDDECISION', 'KXFED', 'KXCPI', 'KXCPIYOY', 'KXCPICORE', 'KXCPICOREYOY', 'KXPAYROLLS', 'KXU3',
        'KXINX', 'KXINXU', 'KXNASDAQ100', 'KXNASDAQ100U', 'KXEURUSD', 'KXEURUSDH', 'KXUSDJPY', 'KXUSDJPYH',
        'btc-above', 'btc-price', 'eth-above', 'eth-price', 'fed-decision', 'cpi', 'unemployment', 'payrolls')),
    event         text not null,
    title         text not null,
    label         text not null,
    payoff        text not null check (payoff in ('above', 'below', 'between', 'exact', 'outcome')),
    low           double precision,
    high          double precision,
    inclusive     boolean not null default false,  -- the strike itself counts (≥, ≤)
    close_time    timestamptz not null,
    bid           double precision,  -- best "yes" bid, null if none
    ask           double precision,
    bid_size      double precision,  -- contracts
    ask_size      double precision,
    last          double precision,
    volume_24h    double precision not null,
    volume_unit   text not null check (volume_unit in ('contracts', 'usd')),
    open_interest double precision,  -- contracts, Kalshi only
    updated       timestamptz not null,  -- when the listing was read
    primary key (venue, id)
);
-- Added 2026-11-16 (step 3), after the table was first created.
alter table manta.markets add column if not exists inclusive boolean not null default false;
-- Added 2026-11-16 (step 5): the fair value and its method (pricing/fairvalues.py): 'options'
-- (Deribit, BTC and ETH), 'consensus-2' (both venues' books), 'consensus-1' (one venue's).
alter table manta.markets add column if not exists fair double precision;
alter table manta.markets add column if not exists fair_method text
    check (fair_method in ('options', 'consensus-2', 'consensus-1'));
-- Added 2026-11-16 (step 6): fee rates. A trade of C contracts at price P pays
-- rate × C × P × (1 − P); null where the venue's fee type isn't one the model knows.
alter table manta.markets add column if not exists fee_taker double precision;
alter table manta.markets add column if not exists fee_maker double precision;

-- The same event on Kalshi and Polymarket (step 4, recorder/internal/crossvenue): replaced with
-- manta.markets every minute. A side is one contract or, for a "bundle", the sum of Polymarket's
-- buckets above Kalshi's threshold (bid and ask summed, size the smallest bucket's).
create table if not exists manta.pairs (
    topic           text not null,  -- "Fed decision, Dec 2026 meeting"
    question        text not null,  -- "No change"
    kind            text not null check (kind in ('same', 'bundle', 'near')),
    note            text not null,  -- what differs, for "near"
    close_time      timestamptz not null,
    ord             integer not null,  -- order within the topic
    kalshi_ids      text[] not null,
    kalshi_bid      double precision,
    kalshi_ask      double precision,
    kalshi_bid_size double precision,
    kalshi_ask_size double precision,
    poly_ids        text[] not null,
    poly_bid        double precision,
    poly_ask        double precision,
    poly_bid_size   double precision,
    poly_ask_size   double precision,
    updated         timestamptz not null,
    primary key (topic, question)
);

-- Liquidity samples (step 6b, pricing/liquidity.py): one row per contract family every 15
-- minutes. "Active" contracts are quoted on both sides with a midpoint from 5¢ to 95¢; spread
-- and size are medians over them (size: the smaller of the best bid's and ask's, in contracts).
create table if not exists manta.liquidity (
    ts        timestamptz not null,
    venue     text not null,
    family    text not null,
    contracts integer not null,  -- open contracts in the family
    active    integer not null,
    spread    double precision,  -- null with no active contract
    size      double precision,
    primary key (ts, venue, family)
);

-- Implied distributions (step 7, pricing/distribution.py): one row per ladder event, replaced
-- every minute with manta.markets. `curve` is the fitted [[x, P(value > x)], …]; quantiles,
-- mean and volatility are null where the quotes don't reach (see the module's docstring).
create table if not exists manta.distributions (
    venue       text not null,  -- kalshi, polymarket, or both (economics combined across venues)
    family      text not null,
    event       text not null,
    title       text not null,
    close_time  timestamptz not null,
    method      text not null,  -- consensus-2 or consensus-1, as for fair values
    curve       jsonb not null,
    median      double precision,
    q25         double precision,
    q75         double precision,
    mean        double precision,
    sd          double precision,
    vol         double precision,  -- annualized, from the quartiles (prices only)
    deribit_vol double precision,  -- Deribit's at-the-money volatility at the same close (crypto)
    spread      double precision,  -- median bid–ask spread of the ladder's two-sided quotes
    updated     timestamptz not null,
    primary key (venue, event)
);

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
