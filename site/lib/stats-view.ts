// Presentation helpers for the accuracy answer (/insights): which comparison leads, and what it says in
// words. Pure, tested in stats-view.test.ts; the scores themselves come from scoring.ts unchanged.
import type { Score } from "./scoring";

export type Line = { cat: string; venue: string; horizon: number; s: Score };

/** The comparison to lead with: crypto, where fair value comes from Deribit's options and so is
 *  independent of the venue, with a range (enough closes), the most closes first. */
export function headline(lines: Line[]): Line | null {
  const ok = lines.filter(
    (l) => l.cat === "Crypto" && l.s.diff !== null && l.s.fair !== null && l.s.venueF !== null,
  );
  return ok.sort((a, b) => b.s.fairEvents - a.s.fairEvents)[0] ?? null;
}

/** Fair value against the venue on the same contracts: "better" or "worse" only when the whole
 *  90% range is on one side of zero, else "same". pct: how much lower (better) fair value's Brier
 *  score is, as a share of the venue's (negative: worse). */
export function verdict(s: Score): { kind: "better" | "worse" | "same"; pct: number } | null {
  if (s.diff === null || s.fair === null || !s.venueF) return null;
  const pct = ((s.venueF - s.fair) / s.venueF) * 100;
  const kind = s.diff[1] < 0 ? "better" : s.diff[0] > 0 ? "worse" : "same";
  return { kind, pct };
}

/** How far a set of calibration buckets sits from the diagonal: the average gap between what the
 *  prices said and the share that paid out, weighted by contracts per bucket (0.03 = 3 points).
 *  `n` is the number of contracts behind it. Only the series in `who` count. */
export function calibrationMiss(
  points: { who: string; n: number; pred: number; hit: number }[],
  who: string[],
): { n: number; miss: number } | null {
  const ps = points.filter((p) => who.includes(p.who));
  const n = ps.reduce((a, p) => a + p.n, 0);
  if (n === 0) return null;
  return { n, miss: ps.reduce((a, p) => a + p.n * Math.abs(p.hit - p.pred), 0) / n };
}
