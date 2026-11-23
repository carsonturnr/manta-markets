// One event as a card: its question and its top outcomes as probability bars, with our fair
// value as a small mint dot on each. The fair-value gap in points is shown on the event page.
// A server component: plain markup, no JavaScript in the browser.
import Link from "next/link";
import type { Event } from "@/lib/events";
import { featured, mid, type Outcome, outcomeLabel, usableFair, verdict } from "@/lib/outcomes";

export const pct = (p: number | null) =>
  p === null ? "–" : p < 0.01 ? "<1%" : p > 0.99 ? ">99%" : `${Math.round(p * 100)}%`;

export const eventHref = (e: Pick<Event, "venue" | "event">) =>
  `/m/${e.venue}/${encodeURIComponent(e.event)}`;

const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : "Polymarket");

/** Time left, short: "in 42 min", "in 5 h", "in 17 days". */
export function closesIn(close: number, now: number): string {
  const m = Math.round((close - now) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} days`;
}

export function volumeText(v: number, unit: "contracts" | "usd"): string {
  const n = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v));
  return unit === "usd" ? `$${n} traded today` : `${n} contracts today`;
}

/** Beside an outcome whose price is 3 points or more from our fair value: the gap in points,
 * green when fair value is above the price, red when below. */
export function Verdict({ o }: { o: Outcome }) {
  const v = verdict(o);
  const f = usableFair(o);
  const m = mid(o);
  if (!v || f === null || m === null) return null;
  const d = Math.round((f - m) * 1000) / 10;
  return (
    <span
      className={`gap-pts ${v === "cheap" ? "up" : "down"}`}
      title={`Fair value ${Math.abs(d)} points ${d > 0 ? "above" : "below"} the midpoint`}
    >
      {d > 0 ? "+" : "−"}
      {Math.abs(d).toFixed(1)} pts
    </span>
  );
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

export default function EventCard({ e, now }: { e: Event; now: number }) {
  return (
    <Link href={eventHref(e)} className="event-card">
      <div className="event-q">{e.question}</div>
      <div className="event-meta">
        <span className={`venue ${e.venue}`}>{venueName(e.venue)}</span> · closes{" "}
        {closesIn(e.close, now)}
      </div>
      <div className="event-outcomes">
        {featured(e.outcomes, 3).map((o) => (
          <div key={o.id} className="outcome">
            <div className="outcome-lab">
              <span>
                {outcomeLabel(o)}
              </span>
              <ProbBar o={o} />
            </div>
            <b className="num">{pct(mid(o))}</b>
          </div>
        ))}
      </div>
      <div className="event-foot">
        <span>{volumeText(e.volume, e.volumeUnit)}</span>
        <span>{e.outcomes.length} outcomes →</span>
      </div>
    </Link>
  );
}
