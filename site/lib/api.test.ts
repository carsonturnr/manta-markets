// Run with: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bearer, costOut, fairOut, hashKey, keyPrefix, limitHeaders, newKey, pairOut, parseCost } from "./api.ts";
import type { Pair } from "./compare.ts";
import { walk } from "./cost.ts";
import type { Row } from "./screener.ts";

test("keys: format, bearer header, hash, prefix", () => {
  const k = newKey();
  assert.match(k, /^manta_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newKey(), k);
  assert.equal(bearer(`Bearer ${k}`), k);
  assert.equal(bearer(`bearer  ${k}`), k);
  assert.equal(bearer(null), null);
  assert.equal(bearer(k), null); // no scheme
  assert.equal(bearer(`Bearer ${k}x`), null); // wrong length
  assert.equal(bearer("Bearer sk_123"), null);
  // SHA-256 of "abc", the standard test vector.
  assert.equal(
    hashKey("abc").toString("hex"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(keyPrefix(k), k.slice(0, 10));
  assert.ok(keyPrefix(k).startsWith("manta_"));
});

test("rate-limit headers", () => {
  const h = limitHeaders(12, 30_500, 0);
  assert.equal(h.get("RateLimit-Limit"), "60");
  assert.equal(h.get("RateLimit-Remaining"), "12");
  assert.equal(h.get("RateLimit-Reset"), "31"); // rounded up
  assert.equal(h.get("Cache-Control"), "private, no-store");
  assert.equal(limitHeaders(-5, 0, 1000).get("RateLimit-Remaining"), "0");
  assert.equal(limitHeaders(0, 0, 1000).get("RateLimit-Reset"), "0");
});

test("/cost query", () => {
  const q = (s: string) => parseCost(new URLSearchParams(s));
  assert.deepEqual(q("venue=kalshi&id=KXBTCD-26NOV2317-T97999.99&n=100"), {
    venue: "kalshi",
    id: "KXBTCD-26NOV2317-T97999.99",
    side: "buy",
    n: 100,
  });
  assert.equal((q(`venue=polymarket&id=0x${"a".repeat(64)}&side=sell&n=1`) as { side: string }).side, "sell");
  assert.equal(typeof q("venue=deribit&id=X&n=1"), "string");
  assert.equal(typeof q("venue=kalshi&n=1"), "string");
  assert.equal(typeof q("venue=kalshi&id=a/b&n=1"), "string");
  assert.equal(typeof q("venue=kalshi&id=X&side=short&n=1"), "string");
  for (const n of ["", "0", "-1", "1.5", "1e9", "abc"])
    assert.equal(typeof q(`venue=kalshi&id=X&n=${n}`), "string", `n=${n}`);
});

test("cost answer: totals and best price, never the levels", () => {
  // Buy 150: 100 at 40¢, 50 at 42¢, no fee → average 0.40667, slippage 0.00667.
  const c = walk("buy", 150, [{ price: 0.4, size: 100 }, { price: 0.42, size: 50 }, { price: 0.5, size: 9 }], () => 0);
  assert.ok(c);
  const out = costOut(c, Date.UTC(2026, 10, 23, 12));
  assert.equal(out.best_price, 0.4);
  assert.equal(out.book_time, "2026-11-23T12:00:00.000Z");
  assert.equal(out.filled, 150);
  assert.ok(Math.abs(out.average_price - 61 / 150) < 1e-12);
  assert.ok(Math.abs(out.slippage - 1 / 150) < 1e-12);
  assert.ok(!("fills" in out));
  assert.ok(!JSON.stringify(out).includes("0.42"));
});

test("fair value and pair answers drop quotes", () => {
  const row: Row = {
    venue: "kalshi", id: "K", family: "KXBTCD", event: "E", title: "t", label: "l", payoff: "above",
    low: 1, high: null, inclusive: false, close: 0, bid: 0.11, ask: 0.13, bidSize: 7, askSize: 8,
    last: 0.12, volume: 9, volumeUnit: "contracts", openInterest: 5, fair: 0.125, fairMethod: "options",
    feeTaker: 0.07, feeMaker: null,
  };
  const f = fairOut(row);
  assert.equal(f.fair, 0.125);
  assert.equal(f.method, "options");
  for (const k of ["bid", "ask", "bidSize", "askSize", "last", "volume", "openInterest"]) assert.ok(!(k in f), k);

  const side = { ids: ["K"], bid: 0.4, ask: 0.41, bidSize: 3, askSize: 4, fair: 0.405, feeAtAsk: 0.017, feeAtBid: 0.017 };
  const p: Pair = { topic: "fed", question: "q", kind: "same", note: "", close: 0, kalshi: side, poly: { ...side, ids: ["P"], labels: ["No change"] } };
  const out = pairOut(p, { cents: 2, inside: false }, { cents: 1, net: -2.4, buy: "kalshi", sell: "polymarket" });
  assert.deepEqual(out.kalshi, { ids: ["K"], fair: 0.405 });
  assert.equal(out.gap_cents, 2);
  assert.deepEqual(out.crossing, { cents: 1, net_cents: -2.4, buy: "kalshi", sell: "polymarket" });
  assert.equal(pairOut(p, null, null).crossing, null);
  assert.ok(!/bid|ask|Size/.test(JSON.stringify(out)));
});
