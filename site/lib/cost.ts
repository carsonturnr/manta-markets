// What buying or selling N contracts actually costs (docs/product.md, step 6): walk the order book
// level by level, then add the venue's fee. Pure math; the contract page passes in the live book
// (lib/venues.ts) and the fee rate (manta.markets.fee_taker). Tested in cost.test.ts.

export type Level = { price: number; size: number }; // "yes" price in dollars, contracts

/** Kalshi's fee schedule (July 2026): rate × C × P × (1 − P), rounded up so that the fee plus the
 * position's cost is a whole centicent ($0.0001). One fill at one price. */
export function kalshiFee(rate: number, contracts: number, price: number): number {
  const cost = contracts * price;
  const raw = rate * contracts * price * (1 - price);
  // Rounded in whole centicents; the 1e-9 keeps an exact amount from rounding up a whole step.
  const total = Math.ceil((cost + raw) * 1e4 - 1e-9) / 1e4;
  return Math.max(0, total - cost);
}

/** Polymarket's fee (docs.polymarket.com, trading fees): rate × C × P × (1 − P), rounded to five
 * decimals, paid by the taker only. */
export function polymarketFee(rate: number, contracts: number, price: number): number {
  return Math.round(rate * contracts * price * (1 - price) * 1e5) / 1e5;
}

export type Fill = Level & { fee: number };

export type Cost = {
  side: "buy" | "sell";
  wanted: number;
  filled: number; // at most the book's depth
  fills: Fill[]; // one per price level taken
  best: number; // the first level's price
  average: number; // average price per contract, before fees
  slippage: number; // average − best for a buy, best − average for a sell: never negative
  value: number; // what changes hands before fees: paid for a buy, received for a sell
  fee: number;
  total: number; // all in: paid (buy, value + fee) or received (sell, value − fee)
  perContract: number; // total / filled
};

/** Take `n` contracts from the book as a taker: a buy takes the asks from the lowest up, a sell
 * hits the bids from the highest down. Each level is one fill, with its own fee. */
export function walk(
  side: "buy" | "sell",
  n: number,
  levels: Level[], // best first: asks rising for a buy, bids falling for a sell
  fee: (contracts: number, price: number) => number,
): Cost | null {
  if (n <= 0 || levels.length === 0) return null;
  const fills: Fill[] = [];
  let left = n;
  for (const l of levels) {
    if (left <= 0) break;
    const q = Math.min(left, l.size);
    fills.push({ price: l.price, size: q, fee: fee(q, l.price) });
    left -= q;
  }
  const filled = n - Math.max(left, 0);
  const value = fills.reduce((s, f) => s + f.size * f.price, 0);
  const feeSum = fills.reduce((s, f) => s + f.fee, 0);
  const average = value / filled;
  const best = levels[0].price;
  const total = side === "buy" ? value + feeSum : value - feeSum;
  return {
    side,
    wanted: n,
    filled,
    fills,
    best,
    average,
    slippage: Math.max(0, side === "buy" ? average - best : best - average),
    value,
    fee: feeSum,
    total,
    perContract: total / filled,
  };
}

/** One contract's taker fee at a price, for comparisons (lib/compare: do crossing prices survive
 * both legs' fees?). Unrounded: rounding is per order, not per contract. */
export const unitFee = (rate: number, price: number) => rate * price * (1 - price);
