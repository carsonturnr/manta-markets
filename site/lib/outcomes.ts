// How an event's contracts are shown to a reader: the question they answer together, the outcomes
// worth featuring, whether a price looks cheap against our fair value. Pure
// functions (no database), shared by server pages and client components; tested in
// outcomes.test.ts.
import { SETTLEMENT, strike } from "./settlement.ts";
import { underlying } from "./units.ts";

/** The fields of a listed contract these functions need (lib/screener.ts Row has them all). */
export type Outcome = {
  family: string;
  label: string;
  payoff: "above" | "below" | "between" | "exact" | "outcome";
  low: number | null;
  high: number | null;
  inclusive: boolean;
  bid: number | null;
  ask: number | null;
  fair: number | null;
  fairMethod: "options" | "consensus-2" | "consensus-1" | null;
};

/** Halfway between the best bid and ask: the market's probability. Null if one side is empty. */
export const mid = (o: Pick<Outcome, "bid" | "ask">) =>
  o.bid === null || o.ask === null ? null : (o.bid + o.ask) / 2;

/** Our fair value, when it's worth comparing with the price. One-venue consensus is fitted to the
 * very quotes it would be compared with, so it can't disagree with them in any useful way. */
export const usableFair = (o: Pick<Outcome, "fair" | "fairMethod">) =>
  o.fair !== null && o.fairMethod !== null && o.fairMethod !== "consensus-1" ? o.fair : null;

/** How far apart the market and our fair value must be (3 points) before we call a price out. */
export const GAP = 0.03;

/** "cheap" when our fair value is at least 3 points above the midpoint ("yes" costs less than we
 * think it's worth), "pricey" when 3 points below, else null. */
export function verdict(o: Outcome): "cheap" | "pricey" | null {
  const f = usableFair(o);
  const m = mid(o);
  if (f === null || m === null) return null;
  if (f - m >= GAP - 1e-9) return "cheap";
  if (m - f >= GAP - 1e-9) return "pricey";
  return null;
}

/** A short name for one outcome. The venue's own label when it says what it means ("$60,500 or
 * above", "Hike 25bps"); Polymarket's price ladders label each contract with a bare number
 * ("60,000"), so those get one built from the strike: "Above $60,000". */
export function outcomeLabel(o: Outcome): string {
  const s = SETTLEMENT[o.family];
  if (!s || /[a-z$%]/i.test(o.label)) return o.label;
  const k = (v: number | null) => (v === null ? "?" : strike(v, s.unit));
  switch (o.payoff) {
    case "above":
      return `${o.inclusive ? "At or above" : "Above"} ${k(o.low)}`;
    case "below":
      return `${o.inclusive ? "At or below" : "Below"} ${k(o.high)}`;
    case "between":
      return `${k(o.low)} – ${k(o.high)}`;
    default:
      return o.label;
  }
}

/** A ladder asks "where will it be?" with one contract per strike; otherwise each contract is a
 * separate answer ("hike", "hold", "cut"). */
export const isLadder = (os: Outcome[]) =>
  os.length > 0 && os.every((o) => o.payoff === "above" || o.payoff === "below");

/** The outcomes worth showing first. On an above/below ladder, the strikes closest to a coin flip
 * (far strikes sit at 1% or 99% and say little), in strike order; otherwise the likeliest. */
export function featured<T extends Outcome>(os: T[], n: number): T[] {
  const withMid = os.filter((o) => mid(o) !== null);
  if (isLadder(withMid)) {
    return [...withMid]
      .sort((a, b) => Math.abs(mid(a)! - 0.5) - Math.abs(mid(b)! - 0.5))
      .slice(0, n)
      .sort((a, b) => mid(b)! - mid(a)!);
  }
  return [...withMid].sort((a, b) => mid(b)! - mid(a)!).slice(0, n);
}

/** When an event closes, in New York time (Kalshi's and Polymarket's own clock for these events):
 * "5 pm ET today", "5 pm ET Nov 27". `now` is passed in so the result can be tested. */
export function whenET(close: number, now: number): string {
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(t);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(close)
    .replace(":00", "")
    .replace(" AM", " am")
    .replace(" PM", " pm");
  return `${time} ET ${day(close) === day(now) ? "today" : day(close)}`;
}

/** The question an event's contracts answer together, in plain words. */
export function question(family: string, os: Outcome[], close: number, now: number): string {
  const s = SETTLEMENT[family];
  const subject = s?.subject ?? family;
  if (family === "KXFEDDECISION" || family === "fed-decision") {
    const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(close);
    return `What will the Fed decide on ${date}?`;
  }
  if (family === "KXBTC15M" || family === "KXETH15M") {
    return `${subject} up or down by ${whenET(close, now)}?`;
  }
  // Prices with a clock time (crypto, stock indexes, FX): "Where will Bitcoin be at 5 pm ET today?"
  if (underlying(family)) return `Where will ${subject} be at ${whenET(close, now)}?`;
  // Economic releases: "What will CPI's 12-month change be?"
  if (os.length > 0 && s) return `What will ${subject} be?`;
  return subject;
}
