// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Bar, defaultMinutes, fill, fromPoints, group, type KalshiCandle, midBars, tradeBars } from "./candles.ts";

const bar = (time: number, o: number, h: number, l: number, c: number, v = 0): Bar => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

test("grouping 1-minute bars into 5-minute bars", () => {
  // 12:00 to 12:06 UTC, one bar a minute. 12:00 is 1795348800 (a multiple of 300).
  const t0 = 1795348800;
  const ones = [
    bar(t0, 0.3, 0.32, 0.3, 0.31, 10),
    bar(t0 + 60, 0.31, 0.35, 0.31, 0.34, 5),
    bar(t0 + 120, 0.34, 0.34, 0.28, 0.29, 20),
    bar(t0 + 240, 0.29, 0.3, 0.29, 0.3, 1), // 12:03 has no bar: nothing traded or quoted
    bar(t0 + 300, 0.3, 0.31, 0.3, 0.31, 7), // 12:05 starts the next five minutes
    bar(t0 + 360, 0.31, 0.33, 0.31, 0.33, 3),
  ];
  // First open 0.30, highest high 0.35, lowest low 0.28, last close 0.30, volume 10+5+20+1 = 36.
  // Then 12:05: open 0.30, high 0.33, low 0.30, close 0.33, volume 7+3 = 10.
  assert.deepEqual(group(ones, 5), [
    bar(t0, 0.3, 0.35, 0.28, 0.3, 36),
    bar(t0 + 300, 0.3, 0.33, 0.3, 0.33, 10),
  ]);
  // Grouping into the same length changes nothing, and doesn't touch the input.
  assert.deepEqual(group(ones, 1), ones);
  assert.equal(ones[0].volume, 10);
});

test("a bar in the middle of a period starts the period at its boundary", () => {
  // 12:07 grouped into 15 minutes belongs to the bar starting 12:00.
  const t0 = 1795348800;
  assert.equal(group([bar(t0 + 420, 0.5, 0.5, 0.5, 0.5)], 15)[0].time, t0);
});

test("Kalshi candles: midpoint and trades", () => {
  const cs: KalshiCandle[] = [
    { time: 60, bid: [0.3, 0.32, 0.29, 0.31], ask: [0.32, 0.34, 0.31, 0.33], trade: null, volume: 0 },
    {
      time: 120,
      bid: [0.31, 0.31, 0.3, 0.3],
      ask: [0.33, 0.35, 0.32, 0.34],
      trade: [0.32, 0.33, 0.32, 0.33],
      volume: 40,
    },
  ];
  // Mid of 0.30 and 0.32 is 0.31; of 0.32 and 0.34 is 0.33; and so on.
  const mid = midBars(cs);
  assert.equal(mid.length, 2);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);
  near(mid[0].open, 0.31);
  near(mid[0].high, 0.33);
  near(mid[0].low, 0.3);
  near(mid[0].close, 0.32);
  // No trade in the first minute: only the second becomes a trade candle.
  assert.deepEqual(tradeBars(cs), [bar(120, 0.32, 0.33, 0.32, 0.33, 40)]);
});

test("Polymarket's price points become candles", () => {
  // Prices at 12:00:10, 12:00:40 and 12:01:05 (ms): two 1-minute candles.
  const t0 = 1795348800 * 1000;
  const pts = [
    { t: t0 + 10_000, price: 0.5 },
    { t: t0 + 40_000, price: 0.52 },
    { t: t0 + 65_000, price: 0.49 },
  ];
  assert.deepEqual(fromPoints(pts, 1), [
    bar(1795348800, 0.5, 0.52, 0.5, 0.52),
    bar(1795348860, 0.49, 0.49, 0.49, 0.49),
  ]);
});

test("fill: skipped minutes become flat zero-volume bars at the last close, up to the end", () => {
  const b = (time: number, close: number, volume = 5) => ({ time, open: close, high: close, low: close, close, volume });
  const out = fill([b(0, 0.4), b(180, 0.5)], 1, 300);
  assert.deepEqual(
    out.map((x) => [x.time, x.close, x.volume]),
    [
      [0, 0.4, 5],
      [60, 0.4, 0],
      [120, 0.4, 0],
      [180, 0.5, 5],
      [240, 0.5, 0],
      [300, 0.5, 0],
    ],
  );
  assert.equal(out[1].high, 0.4);
  assert.deepEqual(fill([], 1, 600), []);
  // `until` inside the last bar adds nothing.
  assert.equal(fill([b(0, 0.4)], 5, 120).length, 1);
});

test("defaultMinutes picks the bar length from the contract's data span", () => {
  assert.equal(defaultMinutes(2 * 3600), 1);
  assert.equal(defaultMinutes(20 * 3600), 15);
  assert.equal(defaultMinutes(10 * 86400), 60);
});
