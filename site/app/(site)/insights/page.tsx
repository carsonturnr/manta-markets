// Insights: Manta's rough data summarised into four answers, each a sentence and a chart, built
// only from data Manta already has. Replaces /liquidity, /stats, /compare and /events
// (2026-11-26); their detail sits under each answer's "More".
import { Suspense } from "react";
import Accuracy from "./accuracy";
import Crossing from "./crossing";
import ReleaseResponse from "./release";
import Spreads from "./spreads";

export const metadata = { title: "Manta: insights" };

const SECTIONS = [
  { id: "spreads", q: "When are spreads tightest?", body: <Spreads /> },
  { id: "accuracy", q: "How accurate are market prices?", body: <Accuracy /> },
  { id: "crossing", q: "What does crossing between venues cost after fees?", body: <Crossing /> },
  { id: "release", q: "How does the book behave around a data release?", body: <ReleaseResponse /> },
];

export default function InsightsPage() {
  return (
    <>
      <h1>Insights</h1>
      <p className="lede">
        Four questions a trader asks, answered from Manta&apos;s own recordings and snapshots of
        Kalshi and Polymarket. Each answer is one sentence and one chart; the numbers behind it are
        under &ldquo;More&rdquo;.
      </p>
      <nav className="insight-nav" aria-label="Questions on this page">
        {SECTIONS.map((s, i) => (
          <a key={s.id} href={`#${s.id}`}>
            <span className="num m3">{String(i + 1).padStart(2, "0")}</span> {s.q}
          </a>
        ))}
      </nav>
      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="insight">
          <h2>{s.q}</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>{s.body}</Suspense>
        </section>
      ))}
    </>
  );
}
