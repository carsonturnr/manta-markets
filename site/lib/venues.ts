// Live data for the contract page (docs/product.md, step 3), from the venues' public APIs, read by
// the site's server and cached briefly. Everything is converted to "yes" terms: on Kalshi a "no"
// bid at 26¢ is a "yes" ask at 74¢; on Polymarket a trade in the "no" token at 3.5¢ is a "yes"
// trade at 96.5¢, on the other side. A failed request returns null and its section says so.
import { cacheLife } from "next/cache";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const DATA = "https://data-api.polymarket.com/v2";

export type Level = { price: number; size: number }; // "yes" price, contracts
export type Book = { bids: Level[]; asks: Level[] }; // best first, at most DEPTH each
export type Trade = { t: number; side: "buy" | "sell"; price: number; size: number }; // buy/sell "yes"
export type Point = { t: number; bid?: number; ask?: number; price?: number };
export type Range = "6h" | "24h" | "7d";
export type Rules = { paragraphs: string[]; source: string };

const DEPTH = 10;

async function get<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "manta-markets" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

const n = (s: string | number) => Number(s);
const best = (levels: Level[], bids: boolean) =>
  levels
    .filter((l) => l.size > 0)
    .sort((a, b) => (bids ? b.price - a.price : a.price - b.price))
    .slice(0, DEPTH);

// ---- Kalshi --------------------------------------------------------------------------------

export async function kalshiBook(ticker: string): Promise<Book | null> {
  "use cache";
  cacheLife({ stale: 5, revalidate: 5, expire: 30 });
  type R = { orderbook_fp: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] } };
  const r = await get<R>(
    `${KALSHI}/markets/${encodeURIComponent(ticker)}/orderbook?depth=${DEPTH}`,
  );
  if (!r) return null;
  const yes = r.orderbook_fp.yes_dollars ?? [];
  const no = r.orderbook_fp.no_dollars ?? [];
  return {
    bids: best(
      yes.map(([p, s]) => ({ price: n(p), size: n(s) })),
      true,
    ),
    // A "no" bid at p is an offer to sell "yes" at 1 − p.
    asks: best(
      no.map(([p, s]) => ({ price: Math.round((1 - n(p)) * 1e4) / 1e4, size: n(s) })),
      false,
    ),
  };
}

export async function kalshiTrades(ticker: string): Promise<Trade[] | null> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  type R = {
    trades: {
      created_time: string;
      yes_price_dollars: string;
      count_fp: string;
      taker_side: string;
    }[];
  };
  const r = await get<R>(`${KALSHI}/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=30`);
  if (!r) return null;
  // The taker buying "no" is selling "yes".
  return r.trades.map((x) => ({
    t: Date.parse(x.created_time),
    side: x.taker_side === "no" ? "sell" : "buy",
    price: n(x.yes_price_dollars),
    size: n(x.count_fp),
  }));
}

// Candle length per range, in minutes: 6 h and 24 h by the minute, 7 d by the hour.
const KALSHI_PERIOD: Record<Range, number> = { "6h": 1, "24h": 1, "7d": 60 };
const RANGE_S: Record<Range, number> = { "6h": 6 * 3600, "24h": 24 * 3600, "7d": 7 * 86400 };

export async function kalshiHistory(
  series: string,
  ticker: string,
  range: Range,
): Promise<Point[] | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  // A whole minute, so the cache key changes once a minute rather than every request.
  const end = Math.floor(Date.now() / 60_000) * 60;
  type C = {
    end_period_ts: number;
    yes_bid: { close_dollars?: string };
    yes_ask: { close_dollars?: string };
  };
  const r = await get<{ candlesticks: C[] }>(
    `${KALSHI}/series/${series}/markets/${encodeURIComponent(ticker)}/candlesticks` +
      `?start_ts=${end - RANGE_S[range]}&end_ts=${end}&period_interval=${KALSHI_PERIOD[range]}`,
  );
  if (!r) return null;
  return r.candlesticks
    .filter((c) => c.yes_bid.close_dollars && c.yes_ask.close_dollars)
    .map((c) => ({
      t: c.end_period_ts * 1000,
      bid: n(c.yes_bid.close_dollars!),
      ask: n(c.yes_ask.close_dollars!),
    }));
}

export async function kalshiRules(ticker: string): Promise<Rules | null> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 });
  type R = { market: { rules_primary?: string; rules_secondary?: string } };
  const r = await get<R>(`${KALSHI}/markets/${encodeURIComponent(ticker)}`);
  if (!r) return null;
  const text = [r.market.rules_primary, r.market.rules_secondary].filter(Boolean).join("\n\n");
  return { paragraphs: paragraphs(text), source: "Kalshi's rules for this market" };
}

// ---- Polymarket ------------------------------------------------------------------------------

type PolyMarket = { conditionId: string; outcomes: string; clobTokenIds: string };
type PolyEvent = { description?: string; markets: PolyMarket[] };

/** The event (cached an hour): its rules text, and each market's "yes" and "no" token ids. */
async function polyEvent(slug: string): Promise<PolyEvent | null> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 });
  const r = await get<PolyEvent[]>(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  return r?.[0] ?? null;
}

/** The market's ["yes", "no"] token ids. */
export async function polyTokens(
  slug: string,
  conditionId: string,
): Promise<[string, string] | null> {
  const e = await polyEvent(slug);
  const m = e?.markets.find((x) => x.conditionId === conditionId);
  if (!m) return null;
  try {
    const outcomes: string[] = JSON.parse(m.outcomes);
    const ids: string[] = JSON.parse(m.clobTokenIds);
    const yes = ids[outcomes.indexOf("Yes")];
    const no = ids[outcomes.indexOf("No")];
    return yes && no ? [yes, no] : null;
  } catch {
    return null;
  }
}

export async function polyRules(slug: string): Promise<Rules | null> {
  const e = await polyEvent(slug);
  if (!e?.description) return null;
  return { paragraphs: paragraphs(e.description), source: "Polymarket's rules for this event" };
}

export async function polyBook(yesToken: string): Promise<Book | null> {
  "use cache";
  cacheLife({ stale: 5, revalidate: 5, expire: 30 });
  type L = { price: string; size: string };
  const r = await get<{ bids: L[]; asks: L[] }>(`${CLOB}/book?token_id=${yesToken}`);
  if (!r) return null;
  const lv = (l: L) => ({ price: n(l.price), size: n(l.size) });
  return { bids: best(r.bids.map(lv), true), asks: best(r.asks.map(lv), false) };
}

export async function polyTrades(conditionId: string, yesToken: string): Promise<Trade[] | null> {
  "use cache";
  cacheLife({ stale: 15, revalidate: 15, expire: 60 });
  type T = {
    token_id: string;
    side: "BUY" | "SELL";
    size: number;
    price: number;
    timestamp: number;
  };
  const r = await get<{ data: T[] }>(`${DATA}/trades?conditionId=${conditionId}&limit=30`);
  if (!r) return null;
  // Only time, side, price and size are kept: the feed also names each trader's wallet, which
  // this page has no reason to show.
  return r.data.map((x) => {
    const yes = x.token_id === yesToken;
    const buy = x.side === "BUY";
    return {
      t: x.timestamp * 1000,
      side: yes === buy ? "buy" : "sell", // buying "no" is selling "yes"
      price: yes ? x.price : Math.round((1 - x.price) * 1e4) / 1e4,
      size: x.size,
    };
  });
}

// Polymarket's history is one price per point (the midpoint or last trade), not a bid and ask.
const POLY_INTERVAL: Record<Range, [string, number]> = {
  "6h": ["6h", 1],
  "24h": ["1d", 5],
  "7d": ["1w", 60],
};

export async function polyHistory(yesToken: string, range: Range): Promise<Point[] | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  const [interval, fidelity] = POLY_INTERVAL[range];
  const r = await get<{ history: { t: number; p: number }[] }>(
    `${CLOB}/prices-history?market=${yesToken}&interval=${interval}&fidelity=${fidelity}`,
  );
  if (!r) return null;
  return r.history.map((h) => ({ t: h.t * 1000, price: h.p }));
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
