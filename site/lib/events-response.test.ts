// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { byMove, cents, et, na, type Reaction, reacting, RELEASE_ID, seconds, thinning } from "./events-response.ts";

const c = (ticker: string, move: number | null): Reaction => ({
  venue: "kalshi",
  ticker,
  event: "E",
  mids: [],
  move_cents: move,
  time_to_90_ms: null,
  depth_10m_before: null,
  depth_30s_before: null,
  spread_t0_cents: null,
  spread_usual_cents: null,
  changes: 0,
});

test("contracts sorted by the size of their move, either direction, nulls last", () => {
  const got = byMove([c("A", 2), c("B", null), c("C", -6), c("D", 0.5)]).map((x) => x.ticker);
  assert.deepEqual(got, ["C", "A", "D", "B"]); // |−6| > 2 > 0.5, then no move
});

test("only moves of 1¢ or more are charted", () => {
  const got = reacting([c("A", 0.5), c("B", -1), c("C", null), c("D", 3)]).map((x) => x.ticker);
  assert.deepEqual(got, ["D", "B"]);
});

test("null shows as n/a; figures keep their sign and unit", () => {
  assert.equal(na(null, cents), "n/a");
  assert.equal(na(6, cents), "+6.0¢");
  assert.equal(cents(-2.5), "−2.5¢");
  assert.equal(cents(0), "0.0¢");
  assert.equal(na(2400, seconds), "2.4 s"); // the plan's example: 90% reached at +2.4 s
  assert.equal(seconds(10_000), "10.0 s");
});

test("book thinning, 10 minutes before against 30 seconds before", () => {
  assert.equal(thinning(1000, 120), "1,000 → 120 (−88%)"); // 120 / 1000 − 1 = −0.88
  assert.equal(thinning(200, 250), "200 → 250 (+25%)");
  assert.equal(thinning(50, 50), "50 → 50 (0%)");
  assert.equal(thinning(0, 30), "0 → 30"); // no percentage of nothing
  assert.equal(thinning(null, 120), "n/a");
});

test("New York time follows the calendar: EST in December, EDT in summer", () => {
  assert.equal(et(Date.UTC(2026, 11, 4, 13, 30)), "Dec 4, 08:30 ET"); // payrolls, 13:30 UTC
  assert.equal(et(Date.UTC(2026, 6, 29, 18, 0)), "Jul 29, 14:00 ET"); // a summer Fed decision
});

test("release ids: date and kind only, nothing that could leave the folder", () => {
  assert.ok(RELEASE_ID.test("2026-12-04-payrolls"));
  assert.ok(!RELEASE_ID.test("../2026-12-04-payrolls"));
  assert.ok(!RELEASE_ID.test("2026-12-04-payrolls.json"));
  assert.ok(!RELEASE_ID.test("payrolls"));
});
