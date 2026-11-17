// History and replay (docs/product.md, step 8). The VM rebuilds Kalshi's order books from our
// recordings every hour (recorder/cmd/replay) and keeps, per event and hour, each market's top
// levels at every minute boundary and its trades; a small file server there (replayserve) hands
// them to this server only, with REPLAY_TOKEN. Fair values and Bitcoin's index come from the
// tracker's tables (manta.quotes, manta.runs), which hold one reading a minute.
import { gunzipSync } from "node:zlib";
import { cacheLife } from "next/cache";
import { sql } from "./db";

const HOURS = 6; // a replay covers the last 6 hours before the close
const IN_PLAY = [0.02, 0.98]; // a market is shown if its midpoint was in this range at least once

type RawMinute = { t: number; bids: [number, number][]; asks: [number, number][] };
type RawTrade = { t: number; side: string; px: number; sz: number };
type RawFile = {
  event: string;
  hour: string;
  markets: Record<string, { minutes: RawMinute[]; trades: RawTrade[] }>;
};

async function fetchReplay(path: string): Promise<Response> {
  const url = process.env.REPLAY_URL;
  const token = process.env.REPLAY_TOKEN;
  if (!url || !token) throw new Error("REPLAY_URL / REPLAY_TOKEN are not set");
  const res = await fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store", // cached below with "use cache"; the token stays out of fetch's cache key
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`replay server: ${path}: ${res.status}`);
  return res;
}

export type Past = { event: string; close: number; settlement: number | null; hours: number };

/** Events with a finished replay, newest close first: the close has passed and the hour holding
 * its last minute has been processed. */
export async function getPastEvents(): Promise<Past[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 120, expire: 600 });
  const index = (await (await fetchReplay("/index")).json()) as Record<string, string[]>;
  const events = Object.keys(index);
  if (events.length === 0) return [];
  const rows = await sql`
    select event_ticker as event, extract(epoch from max(close_time)) * 1000 as close,
           max(settlement_value) as settlement
    from manta.contracts where event_ticker = any(${events}) group by event_ticker`;
  const now = Date.now();
  return rows
    .map((r) => ({
      event: r.event as string,
      close: Number(r.close),
      settlement: r.settlement === null ? null : Number(r.settlement),
      hours: index[r.event].length,
    }))
    .filter((p) => p.close < now && index[p.event].includes(hourOf(p.close - 60_000)))
    .sort((a, b) => b.close - a.close);
}

const hourOf = (ms: number) => new Date(ms).toISOString().slice(0, 13);

export type Replay = {
  event: string;
  close: number;
  settlement: number | null;
  times: number[]; // minute boundaries, ms
  index: (number | null)[]; // Deribit's BTC index at each minute (the tracker's reading)
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
  const tickers = [...merged.keys()].filter((tk) =>
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

  const info = await sql`
    select ticker, floor_strike, result from manta.contracts where ticker = any(${tickers})`;
  const infoBy = new Map(info.map((r) => [r.ticker as string, r]));
  const quotes = await sql`
    select ticker, (extract(epoch from date_trunc('minute', ts)) * 1000)::bigint as t, fair
    from manta.quotes
    where ticker = any(${tickers}) and ts >= to_timestamp(${from / 1000}) and ts <= to_timestamp(${past.close / 1000})`;
  const runs = await sql`
    select (extract(epoch from date_trunc('minute', ts)) * 1000)::bigint as t, deribit_index
    from manta.runs where ts >= to_timestamp(${from / 1000}) and ts <= to_timestamp(${past.close / 1000})`;

  const markets = tickers
    .map((ticker) => {
      const r = infoBy.get(ticker);
      const strike = r?.floor_strike ?? Number(ticker.split("-T").at(-1));
      const q: Replay["markets"][number]["q"] = times.map(() => null);
      for (const x of merged.get(ticker)!.minutes) {
        const i = at.get(x.t);
        if (i !== undefined)
          q[i] = [x.bids[0]?.[0] ?? null, x.asks[0]?.[0] ?? null, x.bids[0]?.[1] ?? 0, x.asks[0]?.[1] ?? 0];
      }
      return { ticker, strike: Number(strike), result: (r?.result as string) ?? null, q, fair: times.map(() => null as number | null) };
    })
    .filter((m) => Number.isFinite(m.strike))
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
  return { event, close: past.close, settlement: past.settlement, times, index: idx, markets, trades };
}
