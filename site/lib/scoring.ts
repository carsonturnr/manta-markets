// Scoring predictions against results (step 9, the accuracy page). Pure functions, tested in
// scoring.test.ts; the queries that feed them are in stats.ts.
//
// The Brier score is the average of (probability − result)², where the result is 1 if the
// contract paid out and 0 if not: 0 is perfect, and always saying 50¢ scores 0.25.
//
// Contracts of one close (every Bitcoin strike at 17:00, say) are decided by the same number, so
// they win or lose together and are not independent evidence. Sample sizes are therefore given
// in closes, and the uncertainty of a difference comes from resampling whole closes (a "cluster
// bootstrap"): draw as many closes as there are, with replacement, recompute, repeat 1,000 times,
// and report the range holding the middle 90% of the results.

/** One close (event) at one horizon, from the database: sums of squared errors. */
export type EventScore = {
  venue: string;
  family: string;
  event: string;
  horizon: number; // minutes before the contract is decided
  n: number; // contracts
  seVenue: number; // Σ (venue mid − result)²
  nFair: number; // contracts that also had a fair value
  seVenueF: number; // Σ (venue mid − result)² over those
  seFair: number; // Σ (fair − result)² over those
};

export type Score = {
  events: number;
  n: number;
  venue: number; // the venue's Brier score over all its contracts
  fairEvents: number;
  nFair: number;
  venueF: number | null; // the venue's Brier over the contracts with a fair value
  fair: number | null; // our fair value's Brier over the same contracts
  diff: [number, number] | null; // 90% range of fair − venue (negative: fair was better)
};

export const MIN_EVENTS = 5; // fewer closes than this: too few to give a range

export function score(rows: EventScore[], iters = 1000): Score {
  const sum = (f: (r: EventScore) => number, rs = rows) => rs.reduce((a, r) => a + f(r), 0);
  const n = sum((r) => r.n);
  const withFair = rows.filter((r) => r.nFair > 0);
  const nFair = sum((r) => r.nFair, withFair);
  return {
    events: new Set(rows.map((r) => r.event)).size,
    n,
    venue: n ? sum((r) => r.seVenue) / n : NaN,
    fairEvents: new Set(withFair.map((r) => r.event)).size,
    nFair,
    venueF: nFair ? sum((r) => r.seVenueF, withFair) / nFair : null,
    fair: nFair ? sum((r) => r.seFair, withFair) / nFair : null,
    diff: diffRange(withFair, iters),
  };
}

/** The cluster bootstrap of fair − venue Brier, by close. Rows of one event (a close can appear
 *  once per horizon, but callers pass one horizon at a time) are resampled together. */
export function diffRange(rows: EventScore[], iters = 1000): [number, number] | null {
  const byEvent = new Map<string, { d: number; n: number }>();
  for (const r of rows) {
    const a = byEvent.get(r.event) ?? { d: 0, n: 0 };
    byEvent.set(r.event, { d: a.d + r.seFair - r.seVenueF, n: a.n + r.nFair });
  }
  const evs = [...byEvent.values()];
  if (evs.length < MIN_EVENTS) return null;
  const rand = mulberry32(1); // a fixed seed: the page shows the same range on every load
  const out: number[] = [];
  for (let k = 0; k < iters; k++) {
    let d = 0;
    let n = 0;
    for (let j = 0; j < evs.length; j++) {
      const e = evs[Math.floor(rand() * evs.length)];
      d += e.d;
      n += e.n;
    }
    out.push(d / n);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(iters * 0.05)], out[Math.ceil(iters * 0.95) - 1]];
}

/** A small seeded random number generator (Mulberry32): uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
