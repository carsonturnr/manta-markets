// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRange, type EventScore, mulberry32, score } from "./scoring.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// One close with a contract at 80¢ that paid out and one at 30¢ that didn't; fair said 90¢ and
// 20¢. Venue: ((0.8 − 1)² + (0.3 − 0)²) = 0.04 + 0.09 = 0.13. Fair: 0.01 + 0.04 = 0.05.
const ev = (event: string, over: Partial<EventScore> = {}): EventScore => ({
  venue: "kalshi", family: "KXBTCD", event, horizon: 60,
  n: 2, seVenue: 0.13, nFair: 2, seVenueF: 0.13, seFair: 0.05, ...over,
}); // prettier-ignore

test("Brier scores are averages over contracts, not over closes", () => {
  // A second close with 1 contract, venue 0.5 on a "no" (0.25), fair 0.4 (0.16).
  const s = score([
    ev("A"),
    ev("B", { n: 1, seVenue: 0.25, nFair: 1, seVenueF: 0.25, seFair: 0.16 }),
  ]);
  assert.equal(s.events, 2);
  assert.equal(s.n, 3);
  close(s.venue, (0.13 + 0.25) / 3);
  close(s.fair!, (0.05 + 0.16) / 3);
  assert.equal(s.diff, null); // 2 closes: too few for a range
});

test("contracts without a fair value count for the venue only", () => {
  const s = score([ev("A", { n: 3, seVenue: 0.13 + 0.36, nFair: 2 })]);
  close(s.venue, 0.49 / 3);
  close(s.venueF!, 0.13 / 2);
  close(s.fair!, 0.05 / 2);
  assert.equal(s.nFair, 2);
});

test("no fair values at all", () => {
  const s = score([ev("A", { nFair: 0, seVenueF: 0, seFair: 0 })]);
  assert.equal(s.fair, null);
  assert.equal(s.venueF, null);
  assert.equal(s.fairEvents, 0);
});

test("the range is a single value when every close says the same", () => {
  const rows = ["A", "B", "C", "D", "E"].map((e) => ev(e));
  const [lo, hi] = diffRange(rows)!;
  close(lo, (0.05 - 0.13) / 2);
  close(hi, (0.05 - 0.13) / 2);
});

test("the range spans the closes and narrows with more of them", () => {
  // Half the closes favour fair by 0.1 a contract, half the venue by 0.1: centred on 0.
  const mixed = (k: number) =>
    Array.from({ length: k }, (_, i) =>
      ev(`E${i}`, { n: 1, nFair: 1, seVenueF: 0.2, seFair: i % 2 ? 0.1 : 0.3 }),
    );
  const [lo10, hi10] = diffRange(mixed(10))!;
  const [lo100, hi100] = diffRange(mixed(100))!;
  assert.ok(lo10 < 0 && hi10 > 0, `${lo10}, ${hi10}`);
  assert.ok(lo10 >= -0.1 && hi10 <= 0.1);
  assert.ok(hi100 - lo100 < hi10 - lo10);
  // About ±1.645 · 0.1/√100 = ±0.016 for 100 closes.
  assert.ok(
    Math.abs(hi100 - 0.0164) < 0.006 && Math.abs(lo100 + 0.0164) < 0.006,
    `${lo100}, ${hi100}`,
  );
});

test("the random numbers are uniform and repeatable", () => {
  const a = mulberry32(1);
  const b = mulberry32(1);
  const xs = Array.from({ length: 10_000 }, () => a());
  assert.deepEqual(
    xs.slice(0, 5),
    Array.from({ length: 5 }, () => b()),
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  close(Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100, 0.5);
});
