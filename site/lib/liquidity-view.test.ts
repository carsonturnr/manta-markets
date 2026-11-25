import assert from "node:assert/strict";
import { test } from "node:test";
import { hourProfile, isThin } from "./liquidity-view.ts";

const cell = (family: string, hour: number, spread: number) => ({
  venue: "kalshi",
  family,
  hour,
  spread,
  n: 4,
});

test("hourProfile: each market against its own typical hour, then averaged", () => {
  // A: 1¢ at 0h, 3¢ at 1h (typical 2¢ → 0.5, 1.5). B: 10¢ both hours (→ 1, 1).
  const p = hourProfile([
    cell("A", 0, 0.01),
    cell("A", 1, 0.03),
    cell("B", 0, 0.1),
    cell("B", 1, 0.1),
  ]);
  assert.equal(p.length, 24);
  assert.ok(Math.abs(p[0]! - 0.75) < 1e-12);
  assert.ok(Math.abs(p[1]! - 1.25) < 1e-12);
  assert.equal(p[2], null);
});

test("isThin: wide, shallow or empty", () => {
  const r = { venue: "kalshi", family: "X", contracts: 10, active: 5, spread: 0.01, size: 100 };
  assert.equal(isThin(r), false);
  assert.equal(isThin({ ...r, spread: 0.05 }), true);
  assert.equal(isThin({ ...r, size: 19 }), true);
  assert.equal(isThin({ ...r, spread: null }), true);
});
