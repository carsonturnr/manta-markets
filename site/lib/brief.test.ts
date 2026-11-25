// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { bookFacts, briefPrompt, parseBullets, priceMoves, tradeFlow } from "./brief.ts";

const bar = (time: number, open: number, close: number, high = close, low = open) => ({
  time,
  open,
  high,
  low,
  close,
  volume: 0,
});

test("priceMoves reads now, an hour ago, a day ago and the day's range", () => {
  const now = 100_000;
  const bars = [
    bar(now - 90_000, 0.3, 0.31), // older than a day: not in the range
    bar(now - 80_000, 0.4, 0.42, 0.45, 0.39),
    bar(now - 3_700, 0.5, 0.52),
    bar(now - 60, 0.55, 0.57, 0.6, 0.54),
  ];
  assert.deepEqual(priceMoves(bars, now), {
    now: 0.57,
    hourAgo: 0.52, // last close at or before now − 3600
    dayAgo: 0.31,
    high: 0.6,
    low: 0.39,
  });
  assert.equal(priceMoves([], now), null);
});

test("priceMoves falls back to the first open when history is short", () => {
  const m = priceMoves([bar(1000, 0.2, 0.25)], 1100);
  assert.equal(m?.dayAgo, 0.2);
  assert.equal(m?.hourAgo, 0.2);
});

test("bookFacts sums contracts within 5¢ of each best price", () => {
  const f = bookFacts({
    bids: [
      { price: 0.54, size: 100 },
      { price: 0.5, size: 50 }, // exactly 4¢ away: in
      { price: 0.49, size: 7 }, // exactly 5¢ away: in
      { price: 0.48, size: 999 }, // out
    ],
    asks: [
      { price: 0.55, size: 10 },
      { price: 0.61, size: 999 },
    ],
  });
  assert.deepEqual(f, { bid: 0.54, ask: 0.55, bidDepth: 157, askDepth: 10 });
  assert.deepEqual(bookFacts({ bids: [], asks: [] }), { bid: null, ask: null, bidDepth: 0, askDepth: 0 });
});

test("tradeFlow counts the last hour's buys and sells", () => {
  const now = 10_000_000;
  const f = tradeFlow(
    [
      { t: now - 1000, side: "buy", price: 0.5, size: 10 },
      { t: now - 2000, side: "sell", price: 0.5, size: 4 },
      { t: now - 3_700_000, side: "buy", price: 0.5, size: 1000 }, // over an hour ago
    ],
    now,
  );
  assert.deepEqual(f, { minutes: 60, trades: 2, bought: 10, sold: 4 });
  // Every trade in the window: the feed may be cut, so the span is the oldest trade's age.
  const cut = tradeFlow([{ t: now - 10 * 60_000 - 1, side: "buy", price: 0.5, size: 3 }], now);
  assert.deepEqual(cut, { minutes: 11, trades: 1, bought: 3, sold: 0 });
  assert.equal(tradeFlow([], now), null);
});

test("briefPrompt states each fact, in cents, and skips what is missing", () => {
  const p = briefPrompt({
    contract: "Bitcoin at or above $59,750 at 5 pm ET",
    venue: "Kalshi",
    minutesToClose: 245,
    moves: { now: 0.57, hourAgo: 0.42, dayAgo: 0.3, high: 0.63, low: 0.12 },
    book: { bid: 0.54, ask: 0.55, bidDepth: 52451, askDepth: 47330 },
    volume24h: "2,905 contracts",
    flow: { minutes: 60, trades: 12, bought: 900, sold: 120 },
    fair: { value: 0.617, method: "Options-implied" },
    other: null,
  });
  assert.match(p, /Closes in 4 hours 5 minutes\./);
  assert.match(p, /Midpoint price now 57¢; an hour ago 42¢; a day ago 30¢\./);
  assert.match(p, /best bid 54¢, best ask 55¢, spread 1¢\./);
  assert.match(p, /52,451 bid, 47,330 offered/);
  assert.match(p, /900 contracts bought, 120 sold/);
  assert.match(p, /Manta's fair value \(Options-implied\): 61\.7¢\./);
  assert.doesNotMatch(p, /Same question on/);
});

test("parseBullets keeps 2 to 5 bullet lines and drops the rest", () => {
  assert.deepEqual(parseBullets("Here you go:\n- One.\n• **Two.**\n* Three.\nnot a bullet"), [
    "One.",
    "Two.",
    "Three.",
  ]);
  assert.equal(parseBullets("- Only one."), null);
  assert.equal(parseBullets("- a\n- b\n- c\n- d\n- e\n- f")?.length, 5);
});
