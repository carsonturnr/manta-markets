import assert from "node:assert/strict";
import { test } from "node:test";
import { ladderSummary, outside } from "./tracker-view.ts";

const q = (bid: number, ask: number, fair: number | null) => ({ bid, ask, fair });

test("outside: cents past the ask (+) or bid (−), 0 inside or without fair value", () => {
  assert.ok(Math.abs(outside(q(0.23, 0.24, 0.173)) - -5.7) < 1e-9);
  assert.ok(Math.abs(outside(q(0.84, 0.85, 0.899)) - 4.9) < 1e-9);
  assert.equal(outside(q(0.56, 0.57, 0.565)), 0);
  assert.equal(outside(q(0.56, 0.57, 0.57)), 0); // at the ask is inside
  assert.equal(outside(q(0.56, 0.57, null)), 0);
});

test("ladderSummary: counts each side and keeps the furthest outside", () => {
  const ladder = [q(0.84, 0.85, 0.899), q(0.56, 0.57, 0.565), q(0.23, 0.24, 0.173), q(0.02, 0.03, null)];
  const s = ladderSummary(ladder);
  assert.equal(s.above, 1);
  assert.equal(s.below, 1);
  assert.equal(s.biggest, ladder[2]);
  assert.equal(ladderSummary([q(0.5, 0.6, 0.55)]).biggest, null);
});
