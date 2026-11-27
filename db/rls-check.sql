-- Checks the site's three logins and row-level security against db/schema.sql, inside one
-- transaction that is rolled back (nothing is kept). Run as a superuser, which may `set role` to
-- each login (on the VM: sudo -u postgres psql -d manta -v ON_ERROR_STOP=1 -f db/rls-check.sql)
-- It stops at the first failure with "FAIL: …"; it ends with "rls-check: all passed".
begin;

-- manta_site: reads market data, writes nothing, can't read the waitlist or account tables.
set local role manta_site;
do $$ begin
    perform count(*) from manta.markets;
    begin
        insert into manta.quality (id, updated, report) values (true, now(), '{}');
        raise exception 'FAIL: manta_site wrote manta.quality';
    exception when insufficient_privilege then null; end;
    begin
        perform count(*) from manta.waitlist;
        raise exception 'FAIL: manta_site read manta.waitlist';
    exception when insufficient_privilege then null; end;
    begin
        perform count(*) from manta.watchlist;
        raise exception 'FAIL: manta_site read manta.watchlist';
    exception when insufficient_privilege then null; end;
end $$;
reset role;

-- manta_signup: may insert an email, never read one back.
set local role manta_signup;
insert into manta.waitlist (email) values ('rls-check@example.com');
do $$ begin
    perform count(*) from manta.waitlist;
    raise exception 'FAIL: manta_signup read manta.waitlist';
exception when insufficient_privilege then null; end $$;
reset role;

-- manta_account: sees and writes only the rows of the user set for the transaction.
set local role manta_account;
select set_config('manta.user_id', 'user_rlscheckA', true);
insert into manta.watchlist (user_id, venue, id) values ('user_rlscheckA', 'kalshi', 'RLS-CHECK');
insert into manta.alerts (user_id, venue, id, kind, threshold)
    values ('user_rlscheckA', 'kalshi', 'RLS-CHECK', 'above', 0.5);
do $$ begin
    if (select count(*) from manta.watchlist) <> 1 then
        raise exception 'FAIL: user A does not see exactly its own watchlist row';
    end if;
    perform set_config('manta.user_id', 'user_rlscheckB', true);
    if (select count(*) from manta.watchlist where user_id = 'user_rlscheckA') > 0
        or (select count(*) from manta.alerts where user_id = 'user_rlscheckA') > 0 then
        raise exception 'FAIL: user B sees user A''s rows';
    end if;
    begin
        insert into manta.watchlist (user_id, venue, id) values ('user_rlscheckA', 'kalshi', 'X');
        raise exception 'FAIL: user B wrote a row as user A';
    exception when insufficient_privilege then null; end;
    perform set_config('manta.user_id', '', true);
    if (select count(*) from manta.watchlist) > 0 then
        raise exception 'FAIL: rows visible with no user set';
    end if;
    begin
        perform count(*) from manta.quotes;
        raise exception 'FAIL: manta_account read manta.quotes';
    exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'rls-check: all passed';
rollback;
