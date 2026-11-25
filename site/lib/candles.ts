// Candles for the contract chart: pure functions, no I/O, so the client can regroup them when the
// timeframe changes and the tests can check them by hand.
//
// A candle (or bar) summarises one period: its first price (open), highest (high), lowest (low) and
// last (close), and how many contracts traded in it (volume). Prices are probabilities, 0 to 1,
// like the rest of the site; times are unix seconds at the period's start, which is what the chart
// library (lightweight-charts) expects.

export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** One of Kalshi's candlesticks: open, high, low, close of the best bid, the best ask and trades. */
export type KalshiCandle = {
  time: number; // period start, unix seconds
  bid: [number, number, number, number];
  ask: [number, number, number, number];
  trade: [number, number, number, number] | null; // null: no trade in the period
  volume: number;
};

/** Each period's midpoint candle: halfway between the bid's and the ask's open, high, low, close.
 * An approximation for high and low (the bid and ask need not peak at the same moment), labelled
 * "Mid" on the chart; the bid and ask lines show the exact quotes. */
export function midBars(cs: KalshiCandle[]): Bar[] {
  return cs.map((c) => ({
    time: c.time,
    open: (c.bid[0] + c.ask[0]) / 2,
    high: (c.bid[1] + c.ask[1]) / 2,
    low: (c.bid[2] + c.ask[2]) / 2,
    close: (c.bid[3] + c.ask[3]) / 2,
    volume: c.volume,
  }));
}

/** Candles of the traded price; periods without a trade are skipped, not drawn flat. */
export function tradeBars(cs: KalshiCandle[]): Bar[] {
  return cs.flatMap((c) =>
    c.trade
      ? [
          {
            time: c.time,
            open: c.trade[0],
            high: c.trade[1],
            low: c.trade[2],
            close: c.trade[3],
            volume: c.volume,
          },
        ]
      : [],
  );
}

/** Price points (Polymarket's history: one price per point, times in ms) grouped into candles of
 * `minutes`. No volume: that history doesn't include it. Points must be in time order. */
export function fromPoints(points: { t: number; price: number }[], minutes: number): Bar[] {
  return group(
    points.map((p) => ({
      time: Math.floor(p.t / 1000),
      open: p.price,
      high: p.price,
      low: p.price,
      close: p.price,
      volume: 0,
    })),
    minutes,
  );
}

/** Regroups candles into longer periods (1-minute bars into 5-minute bars, say): the first open,
 * the highest high, the lowest low, the last close, and the volumes added up. Bars must be in time
 * order; a period starts on a multiple of its length since 1970 (so 5-minute bars start at :00,
 * :05, …, in UTC). */
export function group(bars: Bar[], minutes: number): Bar[] {
  const step = minutes * 60;
  const out: Bar[] = [];
  for (const b of bars) {
    const time = Math.floor(b.time / step) * step;
    const last = out.at(-1);
    if (last && last.time === time) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ ...b, time });
    }
  }
  return out;
}

/** Fills the periods `bars` skip with flat, zero-volume bars at the last close, from the first bar
 * to `until` (unix seconds; the contract's close, or now). Kalshi leaves a minute out when its
 * quote did not change (checked 2026-11-25: 100 of 100 skipped minutes on Fed contracts had the same
 * bid and ask on both sides of the gap), so carrying the close forward draws what happened, and
 * charts on thin contracts stay continuous. Bars must be grouped into `minutes` already. */
export function fill(bars: Bar[], minutes: number, until: number): Bar[] {
  const step = minutes * 60;
  const out: Bar[] = [];
  for (const b of bars) {
    const last = out.at(-1);
    for (let t = last ? last.time + step : b.time; last && t < b.time; t += step) {
      out.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 });
    }
    out.push(b);
  }
  const end = Math.floor(until / step) * step;
  for (let last = out.at(-1); last && last.time + step <= end; last = out.at(-1)) {
    const t = last.time + step;
    out.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 });
  }
  return out;
}

/** The bar length to open a chart on, from how long the contract has data for: 1-minute bars for
 * hourly contracts, 15-minute for daily ones, 1-hour beyond that. */
export function defaultMinutes(spanSeconds: number): 1 | 15 | 60 {
  return spanSeconds <= 3 * 3600 ? 1 : spanSeconds <= 48 * 3600 ? 15 : 60;
}

/** Manta's own recorded 1-minute candles, with Kalshi's API filling the minutes the recording
 * doesn't have (the hour not yet replayed, the days before recording began). Where both have a
 * minute, the recording wins: it is built from the full book Manta captured. In time order. */
export function mergeCandles(recorded: KalshiCandle[], api: KalshiCandle[]): KalshiCandle[] {
  const byTime = new Map(api.map((c) => [c.time, c]));
  for (const c of recorded) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
