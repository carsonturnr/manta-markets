// Small pieces for showing an event's outcomes: a probability as a percent, time to close, and a
// probability bar with our fair value as a small mint dot on it. Used by Markets and the Market page.
import { mid, type Outcome, usableFair } from "@/lib/outcomes";

export const pct = (p: number | null) =>
  p === null ? "–" : p < 0.01 ? "<1%" : p > 0.99 ? ">99%" : `${Math.round(p * 100)}%`;

/** Time left, short: "in 42 min", "in 5 h", "in 17 days". */
export function closesIn(close: number, now: number): string {
  const m = Math.round((close - now) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} days`;
}

/** A probability as a bar, with our fair value as a small mint dot on it. */
export function ProbBar({ o }: { o: Outcome }) {
  const m = mid(o) ?? 0;
  const f = usableFair(o);
  return (
    <span className="prob-bar" aria-hidden="true">
      <i style={{ width: `${m * 100}%` }} />
      {f !== null && <b style={{ left: `${f * 100}%` }} />}
    </span>
  );
}
