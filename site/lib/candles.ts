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
