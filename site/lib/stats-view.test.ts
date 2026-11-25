import assert from "node:assert/strict";
import { test } from "node:test";
import type { Score } from "./scoring.ts";
import { headline, verdict } from "./stats-view.ts";

const s = (o: Partial<Score>): Score => ({
  events: 10,
  n: 100,
  venue: 0.1,
  fairEvents: 10,
  nFair: 100,
  venueF: 0.1,
  fair: 0.099,
  diff: [-0.002, 0.0005],
  ...o,
});

test("verdict: same when the range straddles zero, better/worse only when it doesn't", () => {
  const same = verdict(s({}))!;
  assert.equal(same.kind, "same");
  assert.ok(Math.abs(same.pct - 1) < 1e-9); // 0.099 against 0.1: 1% lower
  assert.equal(verdict(s({ diff: [-0.003, -0.001] }))!.kind, "better");
  assert.equal(verdict(s({ fair: 0.12, diff: [0.01, 0.03] }))!.kind, "worse");
  assert.equal(verdict(s({ diff: null })), null);
});

test("headline: crypto with a range, most closes first", () => {
  const lines = [
    { cat: "Crypto", venue: "kalshi", horizon: 5, s: s({ fairEvents: 200 }) },
    { cat: "Crypto", venue: "kalshi", horizon: 60, s: s({ fairEvents: 900 }) },
    { cat: "Crypto", venue: "polymarket", horizon: 60, s: s({ fairEvents: 3, diff: null }) },
    { cat: "Financials", venue: "kalshi", horizon: 60, s: s({ fairEvents: 5000 }) },
  ];
  assert.equal(headline(lines), lines[1]);
  assert.equal(headline([lines[3]]), null);
});
