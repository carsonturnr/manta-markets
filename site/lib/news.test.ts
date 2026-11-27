// Run with: npm test (node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beyond,
  beyondText,
  delays,
  duration,
  joined,
  marks,
  type NewsItem,
  type NewsMove,
  NEWS_KEY,
  overall,
  signed,
  t0,
} from "./news.ts";

const T = Date.parse("2026-11-25T20:00:00Z");
const item = (o: Partial<NewsItem>): NewsItem => ({
  key: "k",
  source: "fed-press",
  id: "i",
  title: "Title",
  url: "https://example.org",
  stated_ms: T,
  stated_real: true,
  received_ms: T + 23_000,
  ...o,
});
const move = (o: Partial<NewsMove>): NewsMove => ({ key: "k", t0: T, t0_kind: "stated", contracts: 709, moved: 405, moved_before: 380, ...o });

test("t0: the stated time where real, else our receipt; unknown for backfill without a real stated time", () => {
  assert.deepEqual(t0(item({})), { t: T, kind: "stated" });
  assert.deepEqual(t0(item({ source: "dol", stated_real: false })), { t: T + 23_000, kind: "received" });
  assert.equal(t0(item({ stated_real: false, backfill: true })), null);
  // A backfill Fed item keeps its stated time: that one is real.
  assert.deepEqual(t0(item({ backfill: true })), { t: T, kind: "stated" });
});

test("receipt delays per source: real ones only, median of an even count is the middle pair's mean", () => {
  const got = delays([
    item({ received_ms: T + 12_000 }),
    item({ received_ms: T + 20_000 }),
    item({ received_ms: T + 26_000 }),
    item({ received_ms: T + 97_000 }),
    item({ backfill: true, received_ms: T + 9_000_000 }), // collector start: not a real receipt
    item({ source: "dol", stated_real: false, received_ms: T + 5_400_000 }), // stated 12:00, released 13:30
  ]);
  const fed = got.find((d) => d.source === "fed-press")!;
  assert.deepEqual(fed, { source: "fed-press", n: 4, median: 23_000, min: 12_000, max: 97_000 }); // (20 + 26) / 2
  assert.deepEqual(got.find((d) => d.source === "dol"), { source: "dol", n: 0, median: null, min: null, max: null });
});

test("the headline is after minus before", () => {
  assert.equal(beyond(move({})), 25); // 405 − 380
  assert.equal(beyondText(move({})), "+25 more than before");
  assert.equal(beyondText(move({ moved: 109, moved_before: 120 })), "11 fewer than before");
  assert.equal(beyondText(move({ moved: 3, moved_before: 3 })), "same as before");
});

test("overall: one vote per moment, releases and empty moves left out", () => {
  const got = overall([
    move({ key: "a" }), // 405 vs 380 of 709
    move({ key: "b" }), // same minute as a: counted once
    move({ key: "c", t0: T + 3_600_000, contracts: 361, moved: 109, moved_before: 120 }),
    move({ key: "d", t0: T + 7_200_000, release: "2026-12-10-cpi" }),
    move({ key: "e", t0: T + 9_000_000, contracts: 0, moved: 0, moved_before: 0 }),
  ]);
  assert.deepEqual(got, { moments: 2, after: 257, before: 250, contracts: 535 }); // (405 + 109) / 2 …
  assert.equal(overall([]), null);
});

test("joined: newest first, each with its move; an item with no moment placed by its stated time", () => {
  const got = joined({
    items: [
      item({ key: "old", stated_ms: T - 60_000 }),
      item({ key: "new" }),
      // Already in the feed at collector start, days after it was posted: placed by its stated date.
      item({ key: "dol", stated_real: false, backfill: true, stated_ms: T - 30_000, received_ms: T + 86_400_000 }),
    ],
    moves: [move({ key: "new" })],
    status: null,
  });
  assert.deepEqual(got.map((r) => r.it.key), ["new", "dol", "old"]);
  assert.equal(got[1].t, T - 30_000);
  assert.equal(got[0].move?.moved, 405);
  assert.equal(got[1].at, null);
});

test("chart marks: items with a moment, oldest first", () => {
  const got = marks([item({ title: "B" }), item({ source: "bls-cpi", stated_real: false, received_ms: T - 5, title: "A" }), item({ stated_real: false, backfill: true })]);
  assert.deepEqual(got, [
    { t: T - 5, short: "BLS", title: "A" },
    { t: T, short: "Fed", title: "B" },
  ]);
});

test("formats", () => {
  assert.equal(signed(3.5), "+3.5¢");
  assert.equal(signed(-6), "−6.0¢");
  assert.equal(signed(null), "n/a");
  assert.equal(duration(23_400), "23 s");
  assert.equal(duration(146_000), "2 min 26 s");
  assert.ok(NEWS_KEY.test("2026-11-25-fed-press-ebcc18ee"));
  assert.ok(!NEWS_KEY.test("../status"));
});
