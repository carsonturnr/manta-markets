// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { kalshiFee, polymarketFee, walk } from "./cost.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("Kalshi's fee table (fee schedule, July 2026)", () => {
  // "Price for 100 contracts / Fee for 100 contracts": $50 → $1.75 is 0.07·100·0.5·0.5 exactly.
  close(kalshiFee(0.07, 100, 0.5), 1.75);
  // $1.00 → $0.07: 0.07·100·0.01·0.99 = 0.0693, rounded up to the centicent: 0.0693.
  // The table prints cents, $0.07.
  close(kalshiFee(0.07, 100, 0.01), 0.0693);
  // $30 → $1.47: 0.07·100·0.3·0.7 = 1.47.
  close(kalshiFee(0.07, 100, 0.3), 1.47);
  // One contract at 1¢: 0.07·0.01·0.99 = 0.000693 → up to 0.0007.
  close(kalshiFee(0.07, 1, 0.01), 0.0007);
  // Makers where charged: a quarter of the taker rate.
  close(kalshiFee(0.0175, 100, 0.5), 0.4375);
});

test("Polymarket's fee (docs: 100 shares at 50¢ in crypto pay $1.75)", () => {
  close(polymarketFee(0.07, 100, 0.5), 1.75);
  close(polymarketFee(0.05, 100, 0.5), 1.25);
  // 1¢: 0.07·100·0.01·0.99 = 0.0693, five decimals.
  close(polymarketFee(0.07, 100, 0.01), 0.0693);
});

test("walking a book by hand", () => {
  // Buy 150 against asks 40¢×100, 42¢×100: 100 at 40¢ + 50 at 42¢ = $40 + $21 = $61.
  // Average 61/150 = 40.667¢, slippage 0.667¢. Fees: 0.07·100·0.4·0.6 = 1.68 and
  // 0.07·50·0.42·0.58 = 0.8526; total $61 + 2.5326 = $63.5326.
  const fee = (c: number, p: number) => kalshiFee(0.07, c, p);
  const c = walk(
    "buy",
    150,
    [
      { price: 0.4, size: 100 },
      { price: 0.42, size: 100 },
    ],
    fee,
  )!;
  assert.equal(c.filled, 150);
  close(c.value, 61);
  close(c.average, 61 / 150);
  close(c.slippage, 61 / 150 - 0.4);
  close(c.fee, 1.68 + 0.8526);
  close(c.total, 61 + 1.68 + 0.8526);
});

test("a sell receives less than its value, and a short book fills what it can", () => {
  const fee = (c: number, p: number) => polymarketFee(0.05, c, p);
  // Sell 300 into bids 60¢×100, 59¢×100: only 200 fill. $60 + $59 = $119, fees
  // 0.05·100·0.6·0.4 = 1.2 and 0.05·100·0.59·0.41 = 1.2095 → receives $116.5905.
  const c = walk(
    "sell",
    300,
    [
      { price: 0.6, size: 100 },
      { price: 0.59, size: 100 },
    ],
    fee,
  )!;
  assert.equal(c.filled, 200);
  close(c.total, 119 - 1.2 - 1.2095);
  close(c.slippage, 0.6 - 0.595);
  assert.equal(walk("buy", 10, [], fee), null);
});
