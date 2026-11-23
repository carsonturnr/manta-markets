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

-- Predictions for the accuracy page (step 9, pricing/accuracy.py): one row per contract and
-- horizon, the venue's quote and our fair value taken that long before the contract is decided;
-- the result is filled in once the venue settles it. Never replaced, so this is history.
create table if not exists manta.predictions (
    venue       text not null,
    id          text not null,
    family      text not null,
    event       text not null,
    horizon     integer not null,      -- minutes before `decided`: 5, 60, 1440 or 10080
    ts          timestamptz not null,  -- when it was taken
    decided     timestamptz not null,  -- the close; Polymarket economics: the paired Kalshi close
    bid         double precision not null,
    ask         double precision not null,
    fair        double precision,
    fair_method text,
    result      smallint check (result in (0, 1)),  -- 1: the contract paid out
    primary key (venue, id, horizon)
);
create index if not exists predictions_pending on manta.predictions (decided) where result is null;

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

-- The waitlist (step 10): email addresses and when they signed up, nothing else. Covered by the
-- privacy policy (/privacy); deleted on request by the admin login. Kept after the grants above,
-- which give manta_site every table: it must not read this one.
--   - Row-level security is on, and the only policy lets manta_signup insert. No login but the
--     table's owner (the admin) can read, change or delete a row.
--   - manta_signup is the site's sign-up login: it may insert an email and nothing else, so even
--     a bug in the public site can't read the list. Its password is set outside git
--     (manta-snap --init sets it from SIGNUP_DB_PASSWORD).
create table if not exists manta.waitlist (
    email   text primary key check (email = lower(email) and length(email) <= 254
                                    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    created timestamptz not null default now()
);
alter table manta.waitlist enable row level security;
revoke all on manta.waitlist from manta_site;
do $$ begin
    if not exists (select from pg_roles where rolname = 'manta_signup') then
        create role manta_signup login;
    end if;
end $$;
grant usage on schema manta to manta_signup;
grant insert (email) on manta.waitlist to manta_signup;
drop policy if exists signup_insert on manta.waitlist;
create policy signup_insert on manta.waitlist for insert to manta_signup with check (true);

-- Accounts (step 11): watchlists and alerts. Sign-in is Clerk's: it keeps the accounts and their
-- email addresses, so these tables hold only Clerk's user id ("user_…"), never an email. The
-- alert job (pricing/alerts.py, on the VM with the admin login) looks an address up from Clerk
-- when it sends, and keeps nothing.
--   - manta_account is the site's login for these tables and nothing else. Every request first
--     sets manta.user_id to the signed-in user (site/lib/account.ts), and row-level security
--     shows and accepts only that user's rows, so a query missing its "where user_id = …" still
--     can't reach anyone else's. Its password is set outside git (manta-snap --init sets it from
--     ACCOUNT_DB_PASSWORD).
--   - manta_site (read-only, every table by default) is refused these, as with the waitlist.
create table if not exists manta.watchlist (
    user_id text not null check (user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
    venue   text not null,
    id      text not null,  -- manta.markets (venue, id); kept after the contract closes
    added   timestamptz not null default now(),
    primary key (user_id, venue, id)
);
-- An alert watches one contract for one condition, checked every minute:
--   above / below  the midpoint (halfway between bid and ask) is at least / at most `threshold`
--   spread         ask − bid is at least `threshold`
--   depth          the smaller of the best bid's and best ask's size is under `threshold`
--                  contracts, or a side is empty
--   venues         the contract's midpoint and the other venue's for the same event
--                  (manta.pairs) differ by at least `threshold`
-- Prices are in dollars (0.05 = 5¢). It emails when its condition starts to hold (`met` goes
-- from false to true), at most once an hour, and not again until the condition has stopped.
create table if not exists manta.alerts (
    alert_id  bigint generated always as identity primary key,
    user_id   text not null check (user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
    venue     text not null,
    id        text not null,
    kind      text not null check (kind in ('above', 'below', 'spread', 'depth', 'venues')),
    threshold double precision not null check (threshold >= 0),
    created   timestamptz not null default now(),
    met       boolean not null default false,  -- the condition held at the last check
    fired     timestamptz,                     -- the last email
    ended     timestamptz                      -- the contract closed: no longer checked
);
-- The contract's close, copied by the alert job while it is listed: an alert whose contract is
-- missing from the listing ends only once this has passed, so a listing that failed to load
-- part of a venue can't end alerts.
alter table manta.alerts add column if not exists closes timestamptz;
create index if not exists alerts_user on manta.alerts (user_id);
-- Each time an alert fires: when, the value that met it, and whether the email went out.
create table if not exists manta.alert_log (
    alert_id bigint not null references manta.alerts on delete cascade,
    user_id  text not null,
    ts       timestamptz not null,
    value    double precision,  -- null for "depth" when a side is empty
    emailed  boolean not null,
    primary key (alert_id, ts)
);
alter table manta.watchlist enable row level security;
alter table manta.alerts enable row level security;
alter table manta.alert_log enable row level security;
revoke all on manta.watchlist, manta.alerts, manta.alert_log from manta_site;
do $$ begin
    if not exists (select from pg_roles where rolname = 'manta_account') then
        create role manta_account login;
    end if;
end $$;
grant usage on schema manta to manta_account;
grant select, insert, delete on manta.watchlist to manta_account;
grant select, delete on manta.alerts to manta_account;
grant insert (user_id, venue, id, kind, threshold) on manta.alerts to manta_account;
grant select on manta.alert_log to manta_account;
-- current_setting(…, true) is null when unset, and null matches no row.
drop policy if exists own_rows on manta.watchlist;
create policy own_rows on manta.watchlist for all to manta_account
    using (user_id = current_setting('manta.user_id', true))
    with check (user_id = current_setting('manta.user_id', true));
drop policy if exists own_rows on manta.alerts;
create policy own_rows on manta.alerts for all to manta_account
    using (user_id = current_setting('manta.user_id', true))
    with check (user_id = current_setting('manta.user_id', true));
drop policy if exists own_rows on manta.alert_log;
create policy own_rows on manta.alert_log for select to manta_account
    using (user_id = current_setting('manta.user_id', true));

-- API keys and rate limits (step 13, docs/plan-api.md). A key is shown to its user once; only its
-- SHA-256 is kept. manta_account (signed-in pages, row-level security as for the watchlist) lists,
-- creates and deletes a user's own keys. Requests are checked by manta.api_use() alone: it runs as
-- the table owner, so no login can read the hashes or the counters.
create table if not exists manta.api_keys (
    key_id    bigint generated always as identity primary key,
    user_id   text not null check (user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
    name      text not null check (length(name) between 1 and 40),
    hash      bytea not null unique,
    prefix    text not null,  -- the key's first 10 characters, to tell keys apart on /account
    created   timestamptz not null default now(),
    last_used timestamptz
);
-- 60 units a minute per user, not per key (three keys must not triple it).
create table if not exists manta.api_usage (
    user_id      text primary key,
    window_start timestamptz not null,
    used         int not null
);
-- The shared cap: at most 2 venue book fetches a second caused by the API, across all callers
-- (decisions 2026-11-23). api_fetches remembers when each contract was last fetched: a /cost
-- inside the site's 2 s book cache costs no venue request.
create table if not exists manta.api_fetches (
    contract text primary key,  -- "venue:id"
    fetched  timestamptz not null
);
create table if not exists manta.api_venue_budget (
    only_row     boolean primary key default true check (only_row),
    window_start timestamptz not null,
    used         int not null
);
alter table manta.api_keys enable row level security;
alter table manta.api_usage enable row level security;
alter table manta.api_fetches enable row level security;
alter table manta.api_venue_budget enable row level security;
revoke all on manta.api_keys, manta.api_usage, manta.api_fetches, manta.api_venue_budget
    from manta_site;
grant select (key_id, name, prefix, created, last_used), delete on manta.api_keys to manta_account;
grant insert (user_id, name, hash, prefix) on manta.api_keys to manta_account;
drop policy if exists own_rows on manta.api_keys;
create policy own_rows on manta.api_keys for all to manta_account
    using (user_id = current_setting('manta.user_id', true))
    with check (user_id = current_setting('manta.user_id', true));

-- One call per API request: finds the key (no row: unknown key), counts `p_cost` units against
-- its user's minute, and with `p_contract` takes one fetch from the shared second unless that
-- contract was fetched in the last 2 s. Units are spent even if the venue budget then refuses.
create or replace function manta.api_use(p_hash bytea, p_cost int, p_contract text default null)
returns table (allowed boolean, remaining int, reset timestamptz, venue_ok boolean)
language plpgsql security definer set search_path = '' as $$
declare
    uid    text;
    this_min timestamptz := date_trunc('minute', now());
    this_sec timestamptz := date_trunc('second', now());
    n      int;
begin
    update manta.api_keys set last_used = now() where hash = p_hash returning user_id into uid;
    if uid is null then return; end if;

    insert into manta.api_usage as u values (uid, this_min, 0)
    on conflict (user_id) do update
        set window_start = this_min, used = 0 where u.window_start < this_min;
    update manta.api_usage set used = used + p_cost
        where user_id = uid and used + p_cost <= 60
        returning used into n;
    allowed := n is not null;
    if not allowed then
        select used into n from manta.api_usage where user_id = uid;
    end if;
    remaining := 60 - n;
    reset := this_min + interval '1 minute';
    venue_ok := true;

    if allowed and p_contract is not null and not exists (
        select from manta.api_fetches f
        where f.contract = p_contract and f.fetched > now() - interval '2 seconds'
    ) then
        insert into manta.api_venue_budget as b values (true, this_sec, 0)
        on conflict (only_row) do update
            set window_start = this_sec, used = 0 where b.window_start < this_sec;
        update manta.api_venue_budget set used = used + 1 where used < 2 returning used into n;
        venue_ok := found;
        if venue_ok then
            insert into manta.api_fetches values (p_contract, now())
            on conflict (contract) do update set fetched = excluded.fetched;
            delete from manta.api_fetches where fetched < now() - interval '1 minute';
        end if;
    end if;
    return next;
end $$;
revoke all on function manta.api_use(bytea, int, text) from public;
grant execute on function manta.api_use(bytea, int, text) to manta_account;
