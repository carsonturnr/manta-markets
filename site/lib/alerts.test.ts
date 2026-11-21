// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, parseThreshold } from "./alerts.ts";

test("cents in, dollars stored", () => {
  assert.equal(parseThreshold("above", "60"), 0.6);
  assert.equal(parseThreshold("spread", "2.5"), 0.025);
  assert.equal(parseThreshold("venues", " 5 "), 0.05);
});

test("depth is a whole number of contracts", () => {
  assert.equal(parseThreshold("depth", "100"), 100);
  assert.equal(typeof parseThreshold("depth", "2.5"), "string");
  assert.equal(typeof parseThreshold("depth", "0"), "string");
});

test("out of range or not a number is an error", () => {
  for (const [kind, raw] of [
    ["above", "0"],
    ["above", "100"],
    ["below", "abc"],
    ["below", ""],
    ["spread", "99"],
    ["spread", "1.25"],
  ] as const)
    assert.equal(typeof parseThreshold(kind, raw), "string", `${kind} ${raw}`);
});

test("descriptions", () => {
  assert.equal(describe("above", 0.6), "Midpoint at or above 60¢");
  assert.equal(describe("spread", 0.025), "Spread at least 2.5¢");
  assert.equal(describe("depth", 1500), "Size at the best bid or ask under 1,500 contracts");
});
