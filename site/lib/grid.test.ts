// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import { borders, parseAreas, resize } from "./grid.ts";

// The terminal's Market layout (globals.css .t-grid-market), as the browser reports it.
const market = parseAreas(
  '"mon chart chart book" "mon chart chart depth" "mon fair ticket tape" "brief board alerts tape"',
);

test("parseAreas reads the computed template", () => {
  assert.deepEqual(market[0], ["mon", "chart", "chart", "book"]);
  assert.equal(market.length, 4);
});

test("borders skip edges that run through one panel", () => {
  const b = borders(market).map((x) => `${x.axis}${x.i} ${x.from}-${x.to} ${x.a}|${x.b}`);
  assert.deepEqual(b, [
    "col0 0-3 mon|chart",
    "col1 2-3 fair|ticket", // the chart spans columns 1-2 in rows 0-1
    "col2 0-3 chart|book",
    "row0 3-3 book|depth", // only the right column changes panel between rows 0 and 1
    "row1 1-3 chart|fair",
    "row2 0-2 mon|brief", // tape spans rows 2-3
  ]);
});

test("resize trades size between the two neighbours and keeps the minimum", () => {
  assert.deepEqual(resize([300, 500, 200], 0, 50, 100), [350, 450, 200]);
  assert.deepEqual(resize([300, 500, 200], 1, 500, 100), [300, 600, 100]);
  assert.deepEqual(resize([300, 500, 200], 0, -500, 100), [100, 700, 200]);
});
