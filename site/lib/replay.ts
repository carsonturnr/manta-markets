// History and replay (docs/product.md, step 8). The VM rebuilds Kalshi's order books from our
// recordings every hour (recorder/cmd/replay) and keeps, per event and hour, each market's top
// levels at every minute boundary and its trades; a small file server there (replayserve) hands
// them to this server only, with REPLAY_TOKEN. Each replayed family is a ladder of "above"
// thresholds; strikes, results and the settlement value come from Kalshi's API (a past event
// never changes), close times from manta.predictions or, for an event it doesn't cover (closes
// before the predictions started), from Kalshi's API. Fair values and Bitcoin's index exist only
// for Bitcoin, from the tracker's minute tables (manta.quotes, manta.runs).
import { gunzipSync } from "node:zlib";
import { cacheLife } from "next/cache";
import { sql } from "./db";
import { FAMILIES } from "./families";
import { fetchReplay } from "./replayserve";

// The families the VM replays (REPLAY_SERIES in infra/deploy/manta-replay.service).
export const REPLAY_FAMILIES = [
  "KXBTCD", "KXETHD", "KXINXU", "KXNASDAQ100U",
  "KXCPI", "KXCPIYOY", "KXCPICORE", "KXCPICOREYOY", "KXPAYROLLS", "KXU3", "KXFED",
]; // prettier-ignore
export const familyName = (f: string) =>
  FAMILIES.find((x) => x.venue === "kalshi" && x.family === f)?.name ?? f;
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";

const HOURS = 6; // a replay covers the last 6 hours before the close
const IN_PLAY = [0.02, 0.98]; // a market is shown if its midpoint was in this range at least once

type RawMinute = { t: number; bids: [number, number][]; asks: [number, number][] };
type RawTrade = { t: number; side: string; px: number; sz: number };
type RawFile = {
  event: string;
  hour: string;
  markets: Record<string, { minutes: RawMinute[]; trades: RawTrade[] }>;
};

export type Past = { event: string; family: string; close: number; hours: number };

/** Events with a finished replay, newest close first: the close has passed and the hour holding
 * its last minute has been processed. */
export async function getPastEvents(): Promise<Past[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 120, expire: 600 });
  const index = (await (await fetchReplay("/index")).json()) as Record<string, string[]>;
  const events = Object.keys(index);
  if (events.length === 0) return [];
  const rows = await sql`
    select event, extract(epoch from max(decided)) * 1000 as close
    from manta.predictions where venue = 'kalshi' and event = any(${events}) group by event`;
  const known = new Map(rows.map((r) => [r.event as string, Number(r.close)]));
  const now = Date.now();
  const closeOf = async (event: string) => {
    const close = known.get(event);
    if (close !== undefined) return close;
    try {
      const ms = (await kalshiEvent(event)).map((m) => Date.parse(m.close_time));
      return ms.length ? Math.max(...ms) : NaN;
    } catch {
      return NaN; // left out this time; the list is rebuilt every 2 minutes
    }
  };
  // About 10 lookups a second (5 every half second), under Kalshi's 20 reads a second: all at
  // once, the 22 recorded series' ~100 unknown events drew 429 (too many requests) on 2026-11-26
  // and dropped from the list. Only the first load pays: each answer is cached a day.
  const closes: number[] = [];
  for (let i = 0; i < events.length; i += 5) {
    const [batch] = await Promise.all([
      Promise.all(events.slice(i, i + 5).map(closeOf)),
      events.slice(i, i + 5).some((e) => !known.has(e)) ? new Promise((r) => setTimeout(r, 500)) : null,
    ]);
    closes.push(...batch);
  }
  return events
    .map((event, k) => ({
      event,
      family: event.split("-")[0],
      close: closes[k],
      hours: index[event].length,
    }))
    .filter((p) => Number.isFinite(p.close))
    .filter((p) => p.close < now && index[p.event].includes(hourOf(p.close - 60_000)))
    .sort((a, b) => b.close - a.close);
}

type KalshiMarket = {
  ticker: string;
  strike_type: string;
  floor_strike: number | null;
  result: string;
  expiration_value: string;
  close_time: string;
};

/** The event's markets from Kalshi's API, cached for a day: a past event never changes, but
 *  Kalshi can take a while to publish its result. */
async function kalshiEvent(event: string): Promise<KalshiMarket[]> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86_400 });
  let r: Response;
  for (let attempt = 1; ; attempt++) {
    r = await fetch(`${KALSHI}/markets?event_ticker=${encodeURIComponent(event)}&limit=1000`, {
      headers: { "User-Agent": "manta-markets" },
      signal: AbortSignal.timeout(20_000),
    });
    // 429: too many requests (the site shares Kalshi's limit with its book and candle reads).
    if (r.status !== 429 || attempt === 3) break;
    await new Promise((done) => setTimeout(done, 1000 * attempt));
  }
  if (!r.ok) throw new Error(`kalshi markets ${event}: ${r.status}`);
  return ((await r.json()) as { markets: KalshiMarket[] }).markets;
}

const hourOf = (ms: number) => new Date(ms).toISOString().slice(0, 13);

export type Replay = {
  event: string;
  family: string;
  close: number;
  settlement: number | null;
  times: number[]; // minute boundaries, ms
  index: (number | null)[]; // Deribit's BTC index at each minute (the tracker's); Bitcoin only
  markets: {
    ticker: string;
    strike: number; // pays if the price is above this
    result: string | null;
    // Per minute: [bid, ask, bid size, ask size]; a missing side is null; null if not recorded.
    q: ([number | null, number | null, number, number] | null)[];
    fair: (number | null)[];
  }[];
  trades: { t: number; m: number; side: string; px: number; sz: number }[]; // m: market index
};

export async function getReplay(event: string): Promise<Replay | null> {
  "use cache";
  cacheLife({ stale: 3600, revalidate: 86_400, expire: 86_400 * 7 }); // a past close never changes
  const past = (await getPastEvents()).find((p) => p.event === event);
  if (!past) return null;
  // Only "above" thresholds: the chart reads each strike's price as P(value > strike).
  const kalshi = (await kalshiEvent(event)).filter(
    (m) => (m.strike_type === "greater" || m.strike_type === "greater_or_equal") && m.floor_strike !== null,
  );
  const infoBy = new Map(kalshi.map((m) => [m.ticker, m]));
  const settled = kalshi.find((m) => m.expiration_value !== "");
  const settlement = settled ? Number(settled.expiration_value) : null;
  const from = past.close - HOURS * 3_600_000;
  const index = (await (await fetchReplay("/index")).json()) as Record<string, string[]>;
  const hours = index[event].filter((h) => {
    const t = Date.parse(h + ":00:00Z");
    return t + 3_600_000 > from && t < past.close;
  });
  const files = await Promise.all(
    hours.map(async (h) => {
      const buf = Buffer.from(await (await fetchReplay(`/file/${event}/${h}.json.gz`)).arrayBuffer());
      return JSON.parse(gunzipSync(buf).toString()) as RawFile;
    }),
  );
  // Merge the hours per market, keeping the window.
  const merged = new Map<string, { minutes: RawMinute[]; trades: RawTrade[] }>();
  for (const f of files) {
    for (const [tk, m] of Object.entries(f.markets)) {
      const cur = merged.get(tk) ?? { minutes: [], trades: [] };
      cur.minutes.push(...m.minutes.filter((x) => x.t >= from && x.t <= past.close));
      cur.trades.push(...m.trades.filter((x) => x.t >= from && x.t <= past.close));
      merged.set(tk, cur);
    }
  }
  const mid = (x: RawMinute) =>
    ((x.bids[0]?.[0] ?? 0) + (x.asks[0]?.[0] ?? 1)) / 2;
  const tickers = [...merged.keys()].filter(
    (tk) =>
      infoBy.has(tk) &&
      merged.get(tk)!.minutes.some((x) => mid(x) >= IN_PLAY[0] && mid(x) <= IN_PLAY[1]),
  );
  // From the first recorded minute (an hourly event is listed only an hour or so before it
  // closes) to the last one before the close: Kalshi clears every book at the close itself.
  const recorded = tickers.flatMap((tk) => merged.get(tk)!.minutes.map((x) => x.t));
  const first = Math.min(...recorded, past.close);
  const lastT = Math.min(Math.max(...recorded, first), past.close - 60_000);
  const times: number[] = [];
  for (let t = first; t <= lastT; t += 60_000) times.push(t);
  const at = new Map(times.map((t, i) => [t, i]));

  const bitcoin = past.family === "KXBTCD";
  const quotes = await sql`
    select ticker, (extract(epoch from date_trunc('minute', ts)) * 1000)::bigint as t, fair
    from manta.quotes
    where ticker = any(${tickers}) and ts >= to_timestamp(${from / 1000}) and ts <= to_timestamp(${past.close / 1000})`;
  const runs = bitcoin
    ? await sql`
    select (extract(epoch from date_trunc('minute', ts)) * 1000)::bigint as t, deribit_index
    from manta.runs where ts >= to_timestamp(${from / 1000}) and ts <= to_timestamp(${past.close / 1000})`
    : [];

  const markets = tickers
    .map((ticker) => {
      const r = infoBy.get(ticker)!;
      const q: Replay["markets"][number]["q"] = times.map(() => null);
      for (const x of merged.get(ticker)!.minutes) {
        const i = at.get(x.t);
        if (i !== undefined)
          q[i] = [x.bids[0]?.[0] ?? null, x.asks[0]?.[0] ?? null, x.bids[0]?.[1] ?? 0, x.asks[0]?.[1] ?? 0];
      }
      const result = r.result === "yes" || r.result === "no" ? r.result : null;
      return { ticker, strike: Number(r.floor_strike), result, q, fair: times.map(() => null as number | null) };
    })
    .sort((a, b) => a.strike - b.strike);
  const mi = new Map(markets.map((m, i) => [m.ticker, i]));
  for (const r of quotes) {
    const i = at.get(Number(r.t));
    const m = mi.get(r.ticker as string);
    if (i !== undefined && m !== undefined && r.fair !== null) markets[m].fair[i] = Number(r.fair);
  }
  const idx: (number | null)[] = times.map(() => null);
  for (const r of runs) {
    const i = at.get(Number(r.t));
    if (i !== undefined) idx[i] = Number(r.deribit_index);
  }
  const trades = markets
    .flatMap((m, k) => merged.get(m.ticker)!.trades.map((x) => ({ t: x.t, m: k, side: x.side, px: x.px, sz: x.sz })))
    .sort((a, b) => a.t - b.t);
  return { event, family: past.family, close: past.close, settlement, times, index: idx, markets, trades };
}
