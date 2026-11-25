// One ladder of Kalshi Bitcoin contracts (one close, one kind), a row per strike: Kalshi's
// bid–ask as a grey bar and our fair value as a mint tick on the same scale. Where fair value
// falls outside the bar, the stretch between them is shaded: that gap is wider than Kalshi's
// spread. Plain HTML and CSS, drawn on the server.
import Link from "next/link";
import { cents, cents1, describe } from "@/lib/format";
import type { Quote } from "@/lib/queries";
import { outside } from "@/lib/tracker-view";

export default function FairLadder({ title, quotes }: { title: string; quotes: Quote[] }) {
  if (quotes.length === 0) return null;
  // Each ladder gets its own scale, rounded up to 10¢: range contracts rarely pass 20¢, and on a
  // 0–100¢ scale their bars would be slivers.
  const top = Math.max(...quotes.map((q) => Math.max(q.ask, q.fair ?? 0)));
  const hi = Math.min(100, Math.ceil((top * 100) / 10) * 10 || 10);
  const pos = (p: number) => `${Math.min(100, (p * 100 * 100) / hi)}%`;
  return (
    <div className="fl">
      <div className="fl-head small m3">
        <span>{title}</span>
        <span className="fl-scale num">
          <span>0¢</span>
          <span>{hi}¢</span>
        </span>
        <span className="num">Kalshi · fair</span>
      </div>
      {quotes.map((q) => {
        const by = outside(q);
        const edge = by > 0 ? q.ask : q.bid;
        return (
          <div key={q.ticker} className="fl-row">
            <Link href={`/c/${q.ticker}`} className="num">
              {describe(q)}
            </Link>
            <span className="fl-track">
              <span
                className="fl-band"
                style={{ left: pos(q.bid), width: `calc(${pos(q.ask)} - ${pos(q.bid)} + 2px)` }}
              />
              {by !== 0 && (
                <span
                  className={by > 0 ? "fl-gap up" : "fl-gap down"}
                  style={{
                    left: pos(Math.min(edge, q.fair!)),
                    width: `calc(${pos(Math.max(edge, q.fair!))} - ${pos(Math.min(edge, q.fair!))})`,
                  }}
                />
              )}
              {q.fair !== null && <span className="fl-fair" style={{ left: pos(q.fair) }} />}
            </span>
            <span className="num fl-val">
              {cents(q.bid)}–{cents(q.ask)}¢ ·{" "}
              <b className={by > 0 ? "up" : by < 0 ? "down" : undefined}>
                {q.fair === null ? "–" : `${cents1(q.fair)}¢`}
              </b>
            </span>
          </div>
        );
      })}
    </div>
  );
}
