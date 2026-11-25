// Live data for the contract page (docs/product.md, step 3), from the venues' public APIs, read by
// the site's server and cached briefly. Everything is converted to "yes" terms: on Kalshi a "no"
// bid at 26¢ is a "yes" ask at 74¢; on Polymarket a trade in the "no" token at 3.5¢ is a "yes"
// trade at 96.5¢, on the other side. A failed request returns null and its section says so.
import { cacheLife } from "next/cache";
import { type Bar, fromPoints, type KalshiCandle, mergeCandles } from "./candles";
import { fetchReplay } from "./replayserve";

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const DATA = "https://data-api.polymarket.com/v2";

export type Level = { price: number; size: number }; // "yes" price, contracts
export type Book = { bids: Level[]; asks: Level[] }; // best first, at most DEPTH each
export type Trade = { t: number; side: "buy" | "sell"; price: number; size: number }; // buy/sell "yes"
export type Resolution = "1m" | "1h"; // candle length fetched from a venue
export type Rules = { paragraphs: string[]; source: string };

// Levels read per side: the page shows the best 10, the cost calculator walks all of them.
const DEPTH = 50;

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
  // 2 s: the terminal polls every 2 s, and the cache is shared by every viewer, so the venue
  // sees at most one request per market every 2 s (Kalshi allows 20 reads a second).
  cacheLife({ stale: 2, revalidate: 2, expire: 30 });
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
  cacheLife({ stale: 3, revalidate: 3, expire: 60 });
  type R = {
    trades: {
      created_time: string;
      yes_price_dollars: string;
      count_fp: string;
      taker_side: string;
    }[];
  };
  const r = await get<R>(`${KALSHI}/markets/trades?ticker=${encodeURIComponent(ticker)}&limit=60`);
  if (!r) return null;
  // The taker buying "no" is selling "yes".
  return r.trades.map((x) => ({
    t: Date.parse(x.created_time),
    side: x.taker_side === "no" ? "sell" : "buy",
    price: n(x.yes_price_dollars),
    size: n(x.count_fp),
  }));
}

// Two resolutions are fetched; the chart regroups them (lib/candles.ts) into the timeframe picked:
// 1-minute candles over the last 24 hours for 1m to 15m, hourly candles over 7 days for 1h and 4h.
const SPAN_S: Record<Resolution, number> = { "1m": 24 * 3600, "1h": 7 * 86400 };
const MINUTES: Record<Resolution, number> = { "1m": 1, "1h": 60 };

export async function kalshiCandles(
  series: string,
  ticker: string,
  res: Resolution,
): Promise<KalshiCandle[] | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  // A whole minute, so the cache key changes once a minute rather than every request.
  const end = Math.floor(Date.now() / 60_000) * 60;
  type OHLC = {
    open_dollars?: string;
    high_dollars?: string;
    low_dollars?: string;
    close_dollars?: string;
  };
  type C = { end_period_ts: number; yes_bid: OHLC; yes_ask: OHLC; price: OHLC; volume_fp?: string };
  const r = await get<{ candlesticks: C[] }>(
    `${KALSHI}/series/${series}/markets/${encodeURIComponent(ticker)}/candlesticks` +
      `?start_ts=${end - SPAN_S[res]}&end_ts=${end}&period_interval=${MINUTES[res]}`,
  );
  if (!r) return null;
  const ohlc = (o: OHLC): [number, number, number, number] | null =>
    o.open_dollars && o.high_dollars && o.low_dollars && o.close_dollars
      ? [n(o.open_dollars), n(o.high_dollars), n(o.low_dollars), n(o.close_dollars)]
      : null;
  // A period with no bid or no ask (a one-sided book) has no midpoint and is left out.
  const api: KalshiCandle[] = r.candlesticks.flatMap((c) => {
    const bid = ohlc(c.yes_bid);
    const ask = ohlc(c.yes_ask);
    if (!bid || !ask) return [];
    return [
      {
        time: c.end_period_ts - MINUTES[res] * 60, // Kalshi stamps a candle with its end
        bid,
        ask,
        trade: ohlc(c.price),
        volume: n(c.volume_fp ?? 0),
      },
    ];
  });
  // 1-minute charts lead with Manta's own recording; Kalshi's candles fill what it lacks.
  return res === "1m" ? mergeCandles(await recordedCandles(ticker), api) : api;
}

/** One Kalshi market's 1-minute candles from Manta's own recording (the replay files, through
 * recorder/cmd/replayserve /candles): its last 24 recorded hours. Empty when the replay server
 * is unreachable or hasn't recorded the market, so the chart falls back to Kalshi's candles. */
async function recordedCandles(ticker: string): Promise<KalshiCandle[]> {
  try {
    const res = await fetchReplay(`/candles/${encodeURIComponent(ticker)}`);
    return (await res.json()) as KalshiCandle[];
  } catch {
    return [];
  }
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
  // 2 s: the terminal polls every 2 s, and the cache is shared by every viewer, so the venue
  // sees at most one request per market every 2 s (Kalshi allows 20 reads a second).
  cacheLife({ stale: 2, revalidate: 2, expire: 30 });
  type L = { price: string; size: string };
  const r = await get<{ bids: L[]; asks: L[] }>(`${CLOB}/book?token_id=${yesToken}`);
  if (!r) return null;
  const lv = (l: L) => ({ price: n(l.price), size: n(l.size) });
  return { bids: best(r.bids.map(lv), true), asks: best(r.asks.map(lv), false) };
}

export async function polyTrades(conditionId: string, yesToken: string): Promise<Trade[] | null> {
  "use cache";
  cacheLife({ stale: 3, revalidate: 3, expire: 60 });
  type T = {
    token_id: string;
    side: "BUY" | "SELL";
    size: number;
    price: number;
    timestamp: number;
  };
  const r = await get<{ data: T[] }>(`${DATA}/trades?conditionId=${conditionId}&limit=60`);
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

// Polymarket's history is one price per point (the midpoint or last trade), not a bid and ask,
// and has no volume. Its interval names the span; fidelity is the minutes between points.
const POLY_INTERVAL: Record<Resolution, [string, number]> = { "1m": ["1d", 1], "1h": ["1w", 60] };

export async function polyCandles(yesToken: string, res: Resolution): Promise<Bar[] | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  const [interval, fidelity] = POLY_INTERVAL[res];
  const r = await get<{ history: { t: number; p: number }[] }>(
    `${CLOB}/prices-history?market=${yesToken}&interval=${interval}&fidelity=${fidelity}`,
  );
  if (!r) return null;
  return fromPoints(
    r.history.map((h) => ({ t: h.t * 1000, price: h.p })),
    MINUTES[res],
  );
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
