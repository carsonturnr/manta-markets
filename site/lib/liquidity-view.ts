// Plain answers from the liquidity samples (lib/liquidity.ts): when in the day spreads are
// tightest, and which markets are thin. Pure functions, so node's tests can load them.
import type { HourCell, Now } from "./liquidity";

/** Thin: a median spread of 5¢ or more, or fewer than 20 contracts at the best prices, or no
 * active contract at all. 5¢ matches Distributions' "thin"; 20 is a small order's worth. */
export const THIN_SPREAD = 0.05;
export const THIN_SIZE = 20;
export const isThin = (r: Now) =>
  r.spread === null || r.spread >= THIN_SPREAD || (r.size ?? 0) < THIN_SIZE;

/** Each hour of the day (UTC) as a share of a typical hour's spread, averaged over markets so a
 * wide market doesn't outweigh the rest: 0.9 means spreads 10% narrower than usual then.
 * A market's "typical" is the mean of its hourly medians. null: no market sampled that hour. */
export function hourProfile(hours: HourCell[]): (number | null)[] {
  const byMarket = new Map<string, HourCell[]>();
  for (const h of hours) {
    const k = `${h.venue}/${h.family}`;
    byMarket.set(k, [...(byMarket.get(k) ?? []), h]);
  }
  const sum = Array<number>(24).fill(0);
  const n = Array<number>(24).fill(0);
  for (const cells of byMarket.values()) {
    const typical = cells.reduce((a, c) => a + c.spread, 0) / cells.length;
    if (!(typical > 0)) continue;
    for (const c of cells) {
      sum[c.hour] += c.spread / typical;
      n[c.hour] += 1;
    }
  }
  return sum.map((s, h) => (n[h] ? s / n[h] : null));
}
