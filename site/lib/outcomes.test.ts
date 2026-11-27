// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featured,
  type Outcome,
  outcomeLabel,
  question,
  verdict,
  whenET,
} from "./outcomes.ts";

const o = (p: Partial<Outcome>): Outcome => ({
  family: "KXBTCD",
  label: "",
  payoff: "above",
  low: null,
  high: null,
  inclusive: false,
  bid: null,
  ask: null,
  fair: null,
  fairMethod: null,
  ...p,
});

test("a price looks cheap or pricey only 3 points or more from our fair value", () => {
  // Mid 0.335 (bid 0.33, ask 0.34): fair 0.38 is 4.5 points above, cheap.
  assert.equal(verdict(o({ bid: 0.33, ask: 0.34, fair: 0.38, fairMethod: "options" })), "cheap");
  // Exactly 3 points above counts.
  assert.equal(verdict(o({ bid: 0.33, ask: 0.35, fair: 0.37, fairMethod: "options" })), "cheap");
  // 2 points either way: no call.
  assert.equal(verdict(o({ bid: 0.33, ask: 0.35, fair: 0.36, fairMethod: "options" })), null);
  // 5 points below: pricey.
  assert.equal(verdict(o({ bid: 0.6, ask: 0.62, fair: 0.56, fairMethod: "consensus-2" })), "pricey");
  // One-venue consensus never gets a call, however far.
  assert.equal(verdict(o({ bid: 0.33, ask: 0.34, fair: 0.6, fairMethod: "consensus-1" })), null);
  // A one-sided book has no midpoint.
  assert.equal(verdict(o({ bid: null, ask: 0.34, fair: 0.6, fairMethod: "options" })), null);
});

test("on a ladder the featured strikes are the ones nearest a coin flip", () => {
  const ladder = [0.98, 0.9, 0.7, 0.52, 0.31, 0.12, 0.02].map((m, i) =>
    o({ low: 60000 + i * 250, bid: m - 0.005, ask: m + 0.005 }),
  );
  // Nearest 50%: 0.52 (2 away), 0.31 (19), 0.70 (20); shown likeliest first.
  assert.deepEqual(
    featured(ladder, 3).map((x) => x.low),
    [60500, 60750, 61000],
  );
});

test("separate answers are featured likeliest first", () => {
  const fed = [
    o({ payoff: "outcome", label: "Hold", bid: 0.07, ask: 0.08 }),
    o({ payoff: "outcome", label: "Hike 25", bid: 0.89, ask: 0.9 }),
    o({ payoff: "outcome", label: "Hike 50", bid: 0.02, ask: 0.03 }),
  ];
  assert.deepEqual(
    featured(fed, 2).map((x) => x.label),
    ["Hike 25", "Hold"],
  );
});

test("a bare-number label gets the strike with its unit; a readable one is kept", () => {
  assert.equal(outcomeLabel(o({ payoff: "above", low: 60000, label: "60,000" })), "Above $60,000");
  assert.equal(
    outcomeLabel(o({ payoff: "above", low: 60499.99, label: "$60,500 or above" })),
    "$60,500 or above",
  );
  assert.equal(outcomeLabel(o({ payoff: "outcome", label: "Hike 25bps" })), "Hike 25bps");
});

test("closing times read in New York time", () => {
  // 2026-11-22 22:00 UTC is 5 pm in New York (EST, UTC−5).
  const close = Date.UTC(2026, 10, 22, 22);
  assert.equal(whenET(close, Date.UTC(2026, 10, 22, 17)), "5 pm ET today");
  assert.equal(whenET(close, Date.UTC(2026, 10, 20, 17)), "5 pm ET Nov 22");
  assert.equal(
    question("KXBTCD", [], close, Date.UTC(2026, 10, 22, 17)),
    "Where will Bitcoin be at 5 pm ET today?",
  );
});
