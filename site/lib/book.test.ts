// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { arbitrage } from "./arb.ts";
import { bookMid, cumulative, depthNear, imbalance } from "./book.ts";
import { kalshiFee, polymarketFee } from "./cost.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// Bids 40¢×100, 39¢×200, 30¢×500; asks 42¢×50, 43¢×100, 50¢×1000. Mid 41¢.
const book = {
  bids: [
    { price: 0.4, size: 100 },
    { price: 0.39, size: 200 },
    { price: 0.3, size: 500 },
  ],
  asks: [
    { price: 0.42, size: 50 },
    { price: 0.43, size: 100 },
    { price: 0.5, size: 1000 },
  ],
};

test("depth near the mid, in dollars", () => {
  near(bookMid(book)!, 0.41);
  // Within 2¢ of 41¢ (39¢ to 43¢): bids 100×$0.40 + 200×$0.39 = $118; asks 50×$0.42 + 100×$0.43 = $64.
  const d = depthNear(book, 0.02);
  near(d.bid, 118);
  near(d.ask, 64);
  // Imbalance (118 − 64) / 182 ≈ +0.297: buyers outweigh sellers near the price.
  near(imbalance(book, 0.02), 54 / 182);
  // An empty side: no mid, nothing near it.
  assert.deepEqual(depthNear({ bids: [], asks: book.asks }, 0.02), { bid: 0, ask: 0 });
  assert.equal(imbalance({ bids: [], asks: [] }, 0.02), 0);
});

test("running totals for a depth chart", () => {
  assert.deepEqual(cumulative(book.bids), [
    { price: 0.4, total: 100 },
    { price: 0.39, total: 300 },
    { price: 0.3, total: 800 },
  ]);
});

test("arbitrage walks both books until a contract stops paying after fees", () => {
  const noFee = () => 0;
  // Buy yes at 40¢ (60 available) then 45¢; the other venue bids 50¢ (100) then 44¢.
  // 40 + (100 − 50) = 90¢ a pair → 60 pairs; next 45 + 50 = 95¢ → 40 more (bid level left: 40);
  // then 45 + (100 − 44) = 101¢ ≥ $1: stop. 100 contracts, cost 60×0.90 + 40×0.95 = $92.
  const f = arbitrage(
    [
      { price: 0.4, size: 60 },
      { price: 0.45, size: 500 },
    ],
    [
      { price: 0.5, size: 100 },
      { price: 0.44, size: 500 },
    ],
    noFee,
    noFee,
  )!;
  assert.equal(f.contracts, 100);
  near(f.cost, 92);
  near(f.profit, 8);
  near(f.worstBuy, 0.45);
  near(f.worstSell, 0.5);
});

test("fees can take a gap away", () => {
  // Kalshi ask 48¢, Polymarket bid 50¢: 2¢ gross. Kalshi's taker fee at 48¢ is 0.07×0.48×0.52 ≈
  // 1.75¢ a contract, Polymarket's at 50¢ (rate 0.04) 1¢: 2.75¢ of fees, so no contract pays.
  const buy = (n: number, p: number) => kalshiFee(0.07, n, p);
  const sell = (n: number, p: number) => polymarketFee(0.04, n, p);
  assert.equal(arbitrage([{ price: 0.48, size: 100 }], [{ price: 0.5, size: 100 }], buy, sell), null);
  // A 6¢ gap survives them: 40¢ vs 46¢, fees ≈ 1.68¢ + 0.99¢.
  const f = arbitrage([{ price: 0.4, size: 100 }], [{ price: 0.46, size: 100 }], buy, sell)!;
  assert.equal(f.contracts, 100);
  assert.ok(f.profit > 3 && f.profit < 3.5, `profit ${f.profit}`);
});
