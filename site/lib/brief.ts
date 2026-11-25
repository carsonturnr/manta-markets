// The "Market brief": a short AI summary of Manta's own data on one contract. This file is the pure
// half (no I/O, tested by npm test): it turns the data into facts, the facts into a prompt, and the
// model's reply into bullets. lib/brief-api.ts fetches the data and calls the model.
//
// Only type imports here: node's test runner can't resolve the site's extensionless imports.
import type { Bar } from "./candles";

type Level = { price: number; size: number };
type Trade = { t: number; side: "buy" | "sell"; price: number; size: number };

export type BriefInput = {
  contract: string; // "Bitcoin at or above $59,750 at 5 pm ET on Nov 25"
  venue: string; // "Kalshi"
  minutesToClose: number;
  moves: ReturnType<typeof priceMoves>;
  book: ReturnType<typeof bookFacts> | null;
  volume24h: string; // "2,905 contracts" or "$12,400"
  flow: ReturnType<typeof tradeFlow>;
  fair: { value: number; method: string } | null;
  other: { venue: string; bid: number | null; ask: number | null; note: string } | null;
};

/** The midpoint now, an hour ago and a day ago, and the day's range, from 1-minute candles
 * (times in unix seconds, oldest first). Null without candles. */
export function priceMoves(bars: Bar[], nowSec: number) {
  if (bars.length === 0) return null;
  // The last close at or before a time; the first bar's open if the history starts later.
  const at = (t: number) => {
    const before = bars.filter((b) => b.time <= t);
    return before.length ? before[before.length - 1].close : bars[0].open;
  };
  const day = bars.filter((b) => b.time > nowSec - 86400);
  return {
    now: bars[bars.length - 1].close,
    hourAgo: at(nowSec - 3600),
    dayAgo: at(nowSec - 86400),
    high: Math.max(...day.map((b) => b.high)),
    low: Math.min(...day.map((b) => b.low)),
  };
}

/** Best bid and ask, and the contracts resting within `within` (in price, 0.05 = 5¢) of each. */
export function bookFacts(book: { bids: Level[]; asks: Level[] }, within = 0.05) {
  const bid: number | null = book.bids[0]?.price ?? null;
  const ask: number | null = book.asks[0]?.price ?? null;
  const sum = (ls: Level[]) => ls.reduce((s, l) => s + l.size, 0);
  return {
    bid,
    ask,
    bidDepth: bid === null ? 0 : sum(book.bids.filter((l) => l.price >= bid - within - 1e-9)),
    askDepth: ask === null ? 0 : sum(book.asks.filter((l) => l.price <= ask + within + 1e-9)),
  };
}

/** Trades over the last `minutes`: how many contracts were bought and sold ("yes" terms, the side
 * that crossed the spread). Null when there are none. The venues' feeds hold only the latest trades
 * (the last 60), so if every trade falls in the window the span is cut to the oldest one. */
export function tradeFlow(trades: Trade[], nowMs: number, window = 60) {
  const recent = trades.filter((t) => t.t >= nowMs - window * 60_000);
  if (recent.length === 0) return null;
  const minutes =
    recent.length === trades.length
      ? Math.max(1, Math.ceil((nowMs - Math.min(...trades.map((t) => t.t))) / 60_000))
      : window;
  const size = (s: "buy" | "sell") =>
    recent.filter((t) => t.side === s).reduce((n, t) => n + t.size, 0);
  return { minutes, trades: recent.length, bought: size("buy"), sold: size("sell") };
}

const c = (p: number | null) => (p === null ? "none" : `${Math.round(p * 1000) / 10}¢`);
const n = (x: number) => Math.round(x).toLocaleString("en-US");

function when(m: number): string {
  if (m < 60) return `${Math.max(0, Math.round(m))} minutes`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} hours ${Math.round(m % 60)} minutes`;
  return `${Math.round(m / 1440)} days`;
}

// Fixed text, so it reads the same for every market; the data goes in the user message.
export const SYSTEM = `You write a short brief on one prediction-market contract for an everyday trader, using only the data you are given.

Prices are in cents for a "yes" contract that pays $1 if the event happens; 57¢ means the market puts the chance at about 57%.

Write 3 to 5 bullets in plain English, each one or two short sentences, each line starting with "- ". Cover, where the data allows:
- how the price has moved and what in the data might explain it (for example one-sided buying), as a possibility, not a fact;
- how easy it is to trade right now: the spread (the gap between the best price to buy and the best price to sell) and how many contracts sit near the best prices;
- any gap between this venue's price and the other venue's price, with the caveat given;
- what to watch before the close.

Describe; never tell the reader to buy, sell or hold, and never predict the outcome. Do not invent news, events or numbers that are not in the data. Skip anything the data does not cover. No heading, no preamble, no closing line.`;

/** The data, one fact per line. */
export function briefPrompt(x: BriefInput): string {
  const lines = [
    `Contract: ${x.contract} (${x.venue}).`,
    `Closes in ${when(x.minutesToClose)}.`,
  ];
  if (x.moves) {
    lines.push(
      `Midpoint price now ${c(x.moves.now)}; an hour ago ${c(x.moves.hourAgo)}; a day ago ${c(x.moves.dayAgo)}.`,
      `Range over the last day: ${c(x.moves.low)} to ${c(x.moves.high)}.`,
    );
  }
  if (x.book) {
    const spread = x.book.bid !== null && x.book.ask !== null ? c(x.book.ask - x.book.bid) : "none";
    lines.push(
      `Order book: best bid ${c(x.book.bid)}, best ask ${c(x.book.ask)}, spread ${spread}.`,
      `Contracts within 5¢ of the best price: ${n(x.book.bidDepth)} bid, ${n(x.book.askDepth)} offered.`,
    );
  }
  lines.push(`Volume over 24 hours: ${x.volume24h}.`);
  lines.push(
    x.flow
      ? `Trades in the last ${x.flow.minutes} minutes: ${x.flow.trades}; ${n(x.flow.bought)} contracts bought, ${n(x.flow.sold)} sold.`
      : "No trades in the last hour.",
  );
  if (x.fair) lines.push(`Manta's fair value (${x.fair.method}): ${c(x.fair.value)}.`);
  if (x.other) {
    lines.push(
      `Same question on ${x.other.venue}: bid ${c(x.other.bid)}, ask ${c(x.other.ask)}. Caveat: ${x.other.note}`,
    );
  }
  return lines.join("\n");
}

/** The reply's bullets ("- " or "• " lines), at most 5; null if fewer than 2 came back. */
export function parseBullets(text: string): string[] | null {
  const bullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s+/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, "").replace(/\*\*/g, ""))
    .slice(0, 5);
  return bullets.length >= 2 ? bullets : null;
}
