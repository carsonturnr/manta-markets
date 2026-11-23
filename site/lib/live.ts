// The relay's message (recorder/internal/relay Update) in the site's book and trade shapes, and
// the tape's merge of pushed trades with older ones. Pure; tested in live.test.ts.
import type { Book, Trade } from "./venues.ts";

export type RelayUpdate = {
  ticker: string;
  live: boolean; // false: the book may have missed a change; no levels until Kalshi's next snapshot
  t: number;
  bids: [number, number][]; // [price $, contracts], best first
  asks: [number, number][];
  trades: { t: number; side: string; px: number; sz: number }[]; // newest first, latest 20
};

const levels = (l: [number, number][]) => l.map(([price, size]) => ({ price, size }));

export function relayBook(u: RelayUpdate): Book {
  return { bids: levels(u.bids), asks: levels(u.asks) };
}

export function relayTrades(u: RelayUpdate): Trade[] {
  return u.trades.map((x) => ({ t: x.t, side: x.side === "buy" ? "buy" : "sell", price: x.px, size: x.sz }));
}

/** Newer trades on top of the older ones that came before them, newest first, at most `max`.
 *  shortcut: older trades in the same millisecond as the oldest newer one are dropped (the relay
 *  times Kalshi's trades to the second), so a tape can miss a print at the seam; harmless. */
export function mergeTrades(newer: Trade[], older: Trade[] | null, max = 60): Trade[] {
  if (!newer.length) return (older ?? []).slice(0, max);
  const seam = newer.at(-1)!.t;
  return [...newer, ...(older ?? []).filter((x) => x.t < seam)].slice(0, max);
}
