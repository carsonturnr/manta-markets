# Plan: the API (build order step 13)

**Status:** proposed 2026-11-23, waiting for Carson's approval. The database migration below needs it.

**What it is:** read-only JSON endpoints for the analytics Manta already computes, behind
per-user keys with a rate limit. Every number is one the site already shows. Venue data terms
(docs/decisions.md, 2026-11-17) allow an API of *derived* analytics, never raw venue data, so the
API returns **no order-book levels, no trades, and no bid/ask quotes**: only what we calculate from them.

## Endpoints (all GET, under /api/v1)

Prices are probabilities in dollars (0.42 = 42¢). Times are ISO 8601 in UTC. Every response is
`{ "data": …, "updated": "<when the numbers were computed>" }`; errors are `{ "error": "…" }`
with 400, 401, 404 or 429.

| Endpoint | Returns | Source (already in site/lib) |
|---|---|---|
| `/fair-values?venue=&family=&event=` | per open contract: venue, id, family, event, label, payoff, low, high, close, `fair`, `method` (`options`, `consensus-2`, `consensus-1`) | manta.markets (`fair`, `fair_method`), as lib/screener.ts |
| `/distributions?family=&event=` | per ladder event: method, median, q25, q75, mean, sd, implied vol, Deribit's vol, and `curve` = our fitted P(value > x) | lib/distributions.ts |
| `/cost?venue=&id=&side=buy\|sell&n=` | for N contracts taken now: filled, average price, slippage, fee, total, per contract | lib/cost.ts `walk` on the live book (lib/venues.ts) |
| `/pairs` | per cross-venue pair: topic, question, kind, close, each side's ids and fair, `gap` (cents, after settlement-rule adjustment as on /compare) and `crossing` (cents before fees, `net` after both legs' taker fees, which venue to buy/sell) | lib/compare.ts `gap`, `crossed` |
| `/liquidity` | per family now: open and active contracts, median spread, median size at best; plus median spread by hour of day | lib/liquidity.ts |

Left out of v1 (propose later if wanted): executable arbitrage size (needs both live books per
pair), replay history, accuracy scores, event response.

`/cost` returns the one average price and the best price the slippage is measured from, never the
levels walked: that is the calculator's answer, not the book.

## Auth: keys made on /account

Recommended as you suggested, with these details:
- A signed-in user creates a key on /account (name it, max 3 live keys). The key is
  `manta_` + 32 random bytes (base64url), **shown once**; we store only its SHA-256 and its first
  10 characters (to tell keys apart on the page). SHA-256 rather than bcrypt: the key is 256 random
  bits, so it cannot be guessed, and a slow hash would only slow every request. Revoke = delete.
- Sent as `Authorization: Bearer manta_…`. No key in the URL (it would end up in logs).
- The key check and rate limit are **one Postgres function**, `manta.api_key_use(hash, cost)`,
  `security definer`, executable only by `manta_account`. It finds the key, counts the request and
  answers allowed / remaining / reset in one round trip, without granting anyone read access to the
  keys table. `manta_site` stays read-only; the API reads analytics through it as the pages do.

## Rate limit: per key, in Postgres

60 units a minute per key, fixed one-minute window kept on the key's own row. `/cost` costs 5 units
(12 a minute) because each distinct contract makes a live venue request, and Kalshi already rate
limits us (decisions 2026-11-15); the others cost 1. Headers on every answer:
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; a 429 adds `Retry-After`.
A Postgres write per request is fine at this scale; move the counter elsewhere only if it is measured
to hurt.

## Caching

The reads reuse the site's cached functions as they are ("use cache": listing 30 s, distributions
60 s, liquidity 5 min, books 2 s), so API traffic adds no database or venue load beyond those.
Responses are `Cache-Control: private, no-store`, so no CDN can hand one key's answer to a caller
without a key.

## Versioning

`/api/v1` in the path. Within v1 we only add fields or endpoints; a rename or removal makes `/v2`,
and v1 stays up at least three months with a notice on the docs page.

## Docs page

`/docs/api` on the site: what each endpoint returns with a curl example and a real response, units,
the rate limit, the data-terms line (derived analytics only), and each method's plain-English
explanation linked to its tool page. Linked from /account (where keys are made) and the footer, not
the header nav (tools only). The demo: create a key on /account, run the page's curl lines.

## The migration (db/schema.sql, appended; needs your go-ahead)

```sql
create table if not exists manta.api_keys (
    key_id       bigint generated always as identity primary key,
    user_id      text not null check (user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
    name         text not null check (length(name) between 1 and 40),
    hash         bytea not null unique,           -- sha256 of the key; the key itself is never stored
    prefix       text not null,                    -- first 10 characters, for display
    created      timestamptz not null default now(),
    last_used    timestamptz,
    window_start timestamptz not null default now(),
    window_used  int not null default 0
);
alter table manta.api_keys enable row level security;
revoke all on manta.api_keys from manta_site;
grant select (key_id, name, prefix, created, last_used), delete on manta.api_keys to manta_account;
grant insert (user_id, name, hash, prefix) on manta.api_keys to manta_account;
create policy own_rows on manta.api_keys for all to manta_account
    using (user_id = current_setting('manta.user_id', true))
    with check (user_id = current_setting('manta.user_id', true));
-- manta.api_key_use(hash bytea, cost int) returns (allowed bool, remaining int, reset timestamptz):
-- security definer, owned by the admin login, `set search_path = ''`, execute revoked from public
-- and granted to manta_account only. Locks the key's row, resets the window if a minute has passed,
-- adds `cost`, sets last_used. Unknown key: no row (401).
```

## Build steps after approval

1. Pure code + tests (lib/api.ts, `node --test`): key format and hashing, query validation, response
   shaping (what is dropped), rate-limit header values.
2. Migration (you run it, or approve me running it) and the /account key section.
3. The five route handlers.
4. /docs/api, then the curl demo against a local `next build && next start`, then the PR.

Not doing: billing, scopes, key expiry, an OpenAPI file, usage charts.
