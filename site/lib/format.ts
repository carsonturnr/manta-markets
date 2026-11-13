import type { Contract } from "./queries";

const usd = (x: number) =>
  "$" + x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** What the contract pays on, in words: "above $68,799.99" or "$68,800 – $68,899.99". */
export function describe(c: Contract): string {
  if (c.strikeType === "greater") return `above ${usd(c.floor!)}`;
  if (c.strikeType === "less") return `below ${usd(c.cap!)}`;
  return `${usd(c.floor!)} – ${usd(c.cap!)}`;
}

export const cents = (p: number) => (p * 100).toFixed(0);
export const cents1 = (p: number) => (p * 100).toFixed(1);
export const price = (x: number) =>
  "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Nov 13, 21:00 UTC". Always UTC: Kalshi's closes and the Deribit expiries are on UTC hours. */
export function utc(ms: number, withDate = true): string {
  const d = new Date(ms);
  const hm = d.toISOString().slice(11, 16);
  if (!withDate) return `${hm} UTC`;
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${md}, ${hm} UTC`;
}

/** Gap in cents: our fair value minus Kalshi's mid. Positive: we think "yes" is worth more. */
export const gap = (fair: number, bid: number, ask: number) => (fair - (bid + ask) / 2) * 100;
