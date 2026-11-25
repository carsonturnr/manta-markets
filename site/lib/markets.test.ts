import assert from "node:assert/strict";
import { test } from "node:test";
import type { Event } from "./events.ts";
import { order, pick, search } from "./markets.ts";
import type { Row } from "./screener.ts";

const row = (label: string, volume: number, bid: number, ask: number) =>
  ({ label, volume, bid, ask }) as Row;
const ev = (e: Partial<Event>) =>
  ({ venue: "kalshi", family: "KXBTCD", category: "Crypto", volumeUnit: "contracts", outcomes: [], ...e }) as Event;

const now = 1_000_000_000;
const btc = ev({
  event: "KXBTCD-26NOV2517",
  question: "Where will Bitcoin be at 5 pm ET today?",
  close: now + 3_600_000,
  // 1,000 contracts at a 40¢ midpoint: $400.
  outcomes: [row("$90,000 or above", 1000, 0.39, 0.41)],
});
const fed = ev({
  venue: "polymarket",
  family: "fed-decision",
  category: "Economics",
  event: "fed-december",
  question: "What will the Fed decide on December 9?",
  close: now + 14 * 86_400_000,
  volume: 500, // dollars already
  volumeUnit: "usd",
  outcomes: [row("25 bps decrease", 0, 0.3, 0.32)],
});

test("filters by category and by closing within 24 hours", () => {
  assert.deepEqual(pick([btc, fed], "Economics", now), [fed]);
  assert.deepEqual(pick([btc, fed], "Closing today", now), [btc]);
  assert.deepEqual(pick([btc, fed], "All", now), [btc, fed]);
});

test("search needs every word, from the question, family name or an outcome", () => {
  assert.deepEqual(search([btc, fed], "fed december"), [fed]);
  assert.deepEqual(search([btc, fed], "BITCOIN 5 pm"), [btc]);
  assert.deepEqual(search([btc, fed], "bps"), [fed]);
  assert.deepEqual(search([btc, fed], "meeting"), [fed]); // family name "Fed meeting decision"
  assert.deepEqual(search([btc, fed], "  "), [btc, fed]);
  assert.deepEqual(search([btc, fed], "ether"), []);
});

test("orders by dollars traded or by close", () => {
  // Polymarket $500 beats Kalshi's 1,000 contracts × 40¢ = $400.
  assert.deepEqual(order([btc, fed], "volume"), [fed, btc]);
  assert.deepEqual(order([fed, btc], "close"), [btc, fed]);
});
