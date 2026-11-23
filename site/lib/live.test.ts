import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTrades, relayBook, relayTrades, type RelayUpdate } from "./live.ts";

const u: RelayUpdate = {
  ticker: "KX-1",
  live: true,
  t: 5000,
  bids: [[0.31, 3], [0.3, 10]],
  asks: [[0.33, 1]],
  trades: [
    { t: 4000, side: "sell", px: 0.31, sz: 2 },
    { t: 3000, side: "buy", px: 0.33, sz: 1 },
  ],
};

test("the relay's book and trades in the site's shapes", () => {
  assert.deepEqual(relayBook(u), {
    bids: [{ price: 0.31, size: 3 }, { price: 0.3, size: 10 }],
    asks: [{ price: 0.33, size: 1 }],
  });
  assert.deepEqual(relayTrades(u)[0], { t: 4000, side: "sell", price: 0.31, size: 2 });
});

test("pushed trades go on top of older ones, without repeating any", () => {
  const polled = [
    { t: 3000, side: "buy" as const, price: 0.33, size: 1 }, // the relay's oldest, again
    { t: 2000, side: "buy" as const, price: 0.32, size: 4 },
  ];
  assert.deepEqual(
    mergeTrades(relayTrades(u), polled).map((x) => x.t),
    [4000, 3000, 2000],
  );
  assert.deepEqual(mergeTrades([], polled).length, 2); // nothing pushed yet: keep what we had
  assert.deepEqual(mergeTrades(relayTrades(u), null).length, 2);
  assert.equal(mergeTrades(relayTrades(u), polled, 1).length, 1);
});
