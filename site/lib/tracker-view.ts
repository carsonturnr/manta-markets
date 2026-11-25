// Presentation helpers for the Bitcoin fair-value tracker: where our fair value sits against
// Kalshi's bid–ask. Pure, tested in tracker-view.test.ts.
import type { Quote } from "./queries";

/** Cents by which fair value sits outside Kalshi's bid–ask: positive above the ask ("yes" looks
 *  cheap on Kalshi), negative below the bid, 0 inside the spread or with no fair value. */
export function outside(q: Pick<Quote, "bid" | "ask" | "fair">): number {
  if (q.fair === null) return 0;
  if (q.fair > q.ask) return (q.fair - q.ask) * 100;
  if (q.fair < q.bid) return (q.fair - q.bid) * 100;
  return 0;
}

/** How many contracts of a ladder have fair value above the ask and below the bid, and the one
 *  furthest outside. */
export function ladderSummary<Q extends Pick<Quote, "bid" | "ask" | "fair">>(quotes: Q[]) {
  let above = 0;
  let below = 0;
  let biggest: Q | null = null;
  for (const q of quotes) {
    const by = outside(q);
    if (by > 0) above++;
    if (by < 0) below++;
    if (by !== 0 && (biggest === null || Math.abs(by) > Math.abs(outside(biggest)))) biggest = q;
  }
  return { above, below, biggest };
}
