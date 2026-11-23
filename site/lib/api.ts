// The API's pure parts (docs/plan-api.md, step 13): keys, request checks, and what each answer
// keeps. Tested in api.test.ts. No next/cache or ./db here (AGENTS.md, learned rules); the
// route handlers in app/api/v1 do the reads.
//
// Venue data terms allow an API of derived analytics, never raw venue data: the shaping
// functions below are where order-book levels, trades and bid/ask quotes are dropped.
import { createHash, randomBytes } from "node:crypto";
import type { crossed, gap, Pair } from "./compare";
import type { Cost } from "./cost";
import type { Row } from "./screener";

// ---- Keys ----------------------------------------------------------------------------------

// "manta_" + 32 random bytes in base64url (43 characters, no padding).
const KEY = /^manta_[A-Za-z0-9_-]{43}$/;

/** A new key: shown to the user once, then only its hash is kept. */
export const newKey = () => `manta_${randomBytes(32).toString("base64url")}`;

/** SHA-256 of the key. A fast hash is enough: 256 random bits cannot be guessed. */
export const hashKey = (key: string) => createHash("sha256").update(key).digest();

/** First 10 characters, shown on /account to tell keys apart. */
export const keyPrefix = (key: string) => key.slice(0, 10);

/** The key from an `Authorization: Bearer manta_…` header, or null. */
export function bearer(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m && KEY.test(m[1]) ? m[1] : null;
}

// ---- Rate limits ---------------------------------------------------------------------------

export const LIMIT = 60; // units a minute per user
export const COST_UNITS = 5; // /cost: it may call a venue
export const MAX_KEYS = 3;

/** The standard rate-limit headers; a refusal adds Retry-After. `reset` is unix ms. */
export function limitHeaders(remaining: number, reset: number, now: number): Headers {
  const secs = Math.max(0, Math.ceil((reset - now) / 1000));
  return new Headers({
    "Cache-Control": "private, no-store",
    "RateLimit-Limit": String(LIMIT),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(secs),
  });
}

// ---- /cost request -------------------------------------------------------------------------

export const MAX_N = 100_000;

export type CostQuery = { venue: "kalshi" | "polymarket"; id: string; side: "buy" | "sell"; n: number };

/** Checks /cost's query; an error message if anything is wrong. */
export function parseCost(q: URLSearchParams): CostQuery | string {
  const venue = q.get("venue");
  const id = q.get("id") ?? "";
  const side = q.get("side") ?? "buy";
  const n = Number(q.get("n") ?? "");
  if (venue !== "kalshi" && venue !== "polymarket") return "venue must be kalshi or polymarket";
  if (!/^[A-Za-z0-9.\-]{1,100}$/.test(id)) return "id is missing or malformed";
  if (side !== "buy" && side !== "sell") return "side must be buy or sell";
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) return `n must be a whole number from 1 to ${MAX_N}`;
  return { venue, id, side, n };
}

// ---- What each answer keeps ----------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

/** One contract's fair value: no bid, ask, sizes, last or volume. */
export const fairOut = (r: Row) => ({
  venue: r.venue,
  id: r.id,
  family: r.family,
  event: r.event,
  label: r.label,
  payoff: r.payoff,
  low: r.low,
  high: r.high,
  close: iso(r.close),
  fair: r.fair,
  method: r.fairMethod,
});

/** Rounds to `d` decimals: strips float noise (0.06929999999999992 → 0.0693) from the output only. */
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Decimals for dollar amounts: each venue's fee precision (lib/cost.ts). Kalshi rounds fee +
 * position cost to a whole $0.0001; Polymarket rounds its fee to $0.00001. */
export const MONEY_DECIMALS = { kalshi: 4, polymarket: 5 } as const;
/** Prices, slippage and per-contract amounts: well below any venue's tick ($0.001). */
export const PRICE_DECIMALS = 6;

/** A walk of the book: the totals and the best price it started from, never the levels. Without
 * the venue's fee rate (`feeKnown` false) the fee and everything after it are null, not 0.
 * Rounded for output only; the calculation in lib/cost.ts is unchanged. */
export function costOut(c: Cost, bookTime: number, feeKnown: boolean, venue: CostQuery["venue"]) {
  const money = (x: number) => round(x, MONEY_DECIMALS[venue]);
  const price = (x: number) => round(x, PRICE_DECIMALS);
  return {
    side: c.side,
    wanted: c.wanted,
    filled: c.filled,
    best_price: price(c.best),
    book_time: iso(bookTime),
    average_price: price(c.average),
    slippage: price(c.slippage),
    value: money(c.value),
    fee: feeKnown ? money(c.fee) : null,
    total: feeKnown ? money(c.total) : null,
    per_contract: feeKnown ? price(c.perContract) : null,
  };
}

/** A cross-venue pair: the gap and any crossing after fees, not the quotes behind them. `g` and
 * `x` are lib/compare's gap(p) and crossed(p), computed by the caller (compare.ts reads the
 * database, so it can't be loaded by node's tests). */
export function pairOut(p: Pair, g: ReturnType<typeof gap>, x: ReturnType<typeof crossed>) {
  return {
    topic: p.topic,
    question: p.question,
    kind: p.kind,
    note: p.note,
    close: iso(p.close),
    kalshi: { ids: p.kalshi.ids, fair: p.kalshi.fair },
    polymarket: { ids: p.poly.ids, labels: p.poly.labels, fair: p.poly.fair },
    gap_cents: g?.cents ?? null,
    gap_inside: g?.inside ?? null,
    crossing: x && { cents: x.cents, net_cents: x.net, buy: x.buy, sell: x.sell },
  };
}
