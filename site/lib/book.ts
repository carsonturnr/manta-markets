// What an order book says at a glance, for the terminal's book and liquidity panels: how much is
// resting near the price, which side outweighs the other, and the running totals a depth chart
// draws. Pure functions on the venues' books (lib/venues.ts); tested in book.test.ts.
import type { Level } from "./cost.ts";
import type { Book } from "./venues.ts";

/** Halfway between the best bid and the best ask; null if either side is empty. */
export const bookMid = (b: Book) => (b.bids[0] && b.asks[0] ? (b.bids[0].price + b.asks[0].price) / 2 : null);

/** Dollars resting within `within` (in probability, 0.01 = 1¢) of the mid on each side: what a
 * quick trade near the price can actually use. A contract's dollar value is its price. */
export function depthNear(b: Book, within: number): { bid: number; ask: number } {
  const m = bookMid(b);
  if (m === null) return { bid: 0, ask: 0 };
  const sum = (ls: Level[]) =>
    ls.filter((l) => Math.abs(l.price - m) <= within + 1e-9).reduce((s, l) => s + l.size * l.price, 0);
  return { bid: sum(b.bids), ask: sum(b.asks) };
}

/** Book imbalance near the mid, from −1 (all asks: sellers outweigh buyers) to +1 (all bids), in
 * dollars within `within` of the mid. 0 when nothing rests there. */
export function imbalance(b: Book, within: number): number {
  const d = depthNear(b, within);
  const total = d.bid + d.ask;
  return total === 0 ? 0 : (d.bid - d.ask) / total;
}

/** Each side's running total of contracts, best price first: the steps of a depth chart. */
export function cumulative(levels: Level[]): { price: number; total: number }[] {
  let total = 0;
  return levels.map((l) => ({ price: l.price, total: (total += l.size) }));
}
