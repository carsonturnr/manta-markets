// How much of a cross-venue price difference can actually be traded. When one venue's best ask for
// "yes" is below the other venue's best bid, buying "yes" on the first and "no" on the second pays
// $1 whatever happens, for less than $1. This walks both books together, level by level, and
// stops at the first contract that would no longer make money after both venues' taker fees.
// Pure; tested in arb.test.ts.
import type { Level } from "./cost.ts";

export type ArbFill = {
  contracts: number; // how many contracts both legs can trade while each still pays
  cost: number; // dollars paid for both legs, fees included
  profit: number; // dollars locked in: contracts × $1 − cost
  worstBuy: number; // the highest "yes" price taken on the buying venue
  worstSell: number; // the lowest "yes" bid taken on the selling venue
};

/** Walk `asks` (buy "yes", best first) against `bids` (the other venue's "yes" bids, best first;
 * buying "no" there costs 1 − bid). `buyFee` and `sellFee` give each leg's fee for n contracts at
 * a "yes" price. A contract counts only if, at its prices, the pair still costs under $1 with
 * fees. Null when not even one contract does. Fees are charged per level, as the venues do. */
export function arbitrage(
  asks: Level[],
  bids: Level[],
  buyFee: (n: number, price: number) => number,
  sellFee: (n: number, price: number) => number,
): ArbFill | null {
  let i = 0;
  let j = 0;
  let aLeft = asks[0]?.size ?? 0;
  let bLeft = bids[0]?.size ?? 0;
  let contracts = 0;
  let cost = 0;
  let worstBuy = 0;
  let worstSell = 0;
  while (i < asks.length && j < bids.length) {
    const a = asks[i].price;
    const b = bids[j].price;
    // One more contract at these two prices: yes at a, no at 1 − b, plus each leg's fee.
    const one = a + (1 - b) + buyFee(1, a) + sellFee(1, b);
    if (one >= 1 - 1e-9) break;
    const n = Math.min(aLeft, bLeft);
    contracts += n;
    cost += n * (a + (1 - b)) + buyFee(n, a) + sellFee(n, b);
    worstBuy = a;
    worstSell = b;
    aLeft -= n;
    bLeft -= n;
    if (aLeft <= 1e-9) aLeft = asks[++i]?.size ?? 0;
    if (bLeft <= 1e-9) bLeft = bids[++j]?.size ?? 0;
  }
  if (contracts === 0) return null;
  return { contracts, cost, profit: contracts - cost, worstBuy, worstSell };
}
