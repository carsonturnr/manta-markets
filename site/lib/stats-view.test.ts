import assert from "node:assert/strict";
import { test } from "node:test";
import type { Score } from "./scoring.ts";
import { calibrationMiss, headline, verdict, worstBand } from "./stats-view.ts";

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

test("calibrationMiss: contract-weighted average distance from the diagonal, chosen series only", () => {
  const pts = [
    { who: "kalshi", n: 30, pred: 0.25, hit: 0.2 }, // 5 points off
    { who: "polymarket", n: 10, pred: 0.75, hit: 0.85 }, // 10 points off
    { who: "fair", n: 1000, pred: 0.5, hit: 0.9 }, // left out
  ];
  const m = calibrationMiss(pts, ["kalshi", "polymarket"])!;
  assert.equal(m.n, 40);
  assert.ok(Math.abs(m.miss - (30 * 0.05 + 10 * 0.1) / 40) < 1e-12); // 0.0625
  assert.equal(calibrationMiss(pts, ["nobody"]), null);
});

test("worstBand: the band furthest from its price, venues pooled, thin bands skipped", () => {
  const pts = [
    { who: "kalshi", bucket: 0, n: 300, pred: 0.05, hit: 0.02 },
    { who: "polymarket", bucket: 0, n: 100, pred: 0.05, hit: 0.06 },
    { who: "kalshi", bucket: 5, n: 500, pred: 0.55, hit: 0.56 },
    { who: "kalshi", bucket: 9, n: 20, pred: 0.95, hit: 0.5 }, // too few to count
    { who: "manta", bucket: 0, n: 1000, pred: 0.05, hit: 0.5 }, // not a venue
  ];
  const w = worstBand(pts, ["kalshi", "polymarket"]);
  assert.equal(w?.bucket, 0);
  assert.equal(w?.n, 400);
  assert.ok(Math.abs(w!.hit - 0.03) < 1e-9); // (300 × 0.02 + 100 × 0.06) / 400
  assert.equal(worstBand(pts, ["kalshi"], 10_000), null);
});
