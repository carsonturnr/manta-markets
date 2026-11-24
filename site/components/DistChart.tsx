// One event's implied distribution as the curve "chance the value ends above x": what the ladder's
// contracts price directly. The middle 50% (25th to 75th percentile) is shaded, the median
// dashed. Plain SVG drawn on the server; hovering a point shows its value through <title>.
import { fmtValue, type Dist } from "@/lib/distributions";

const H = 300;
const PAD = { left: 44, right: 16, top: 12, bottom: 28 };

/** `width` is the drawing's width in SVG units: match it to the space the chart gets, so its text
 * stays near its set size instead of scaling up with a wide panel. */
export default function DistChart({ d, width: W = 840 }: { d: Dist; width?: number }) {
  // Show where the outcome is in doubt: from the last strike still at ≥ 99% to the first at
  // ≤ 1%. Ladders list strikes far out where nothing happens, which would squeeze the curve.
  const lo = d.curve.findLast(([, p]) => p >= 0.99)?.[0] ?? d.curve[0][0];
  const hi = d.curve.find(([, p]) => p <= 0.01)?.[0] ?? d.curve.at(-1)![0];
  const pad = (hi - lo) * 0.05;
  const x0 = Math.max(d.curve[0][0], lo - pad);
  const x1 = Math.min(d.curve.at(-1)![0], hi + pad);
  const shown = d.curve.filter(([v]) => v >= x0 && v <= x1);
  const span = x1 - x0 || 1;
  const x = (v: number) => PAD.left + ((v - x0) / span) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const line = shown.map(([v, p], i) => `${i ? "L" : "M"}${x(v)},${y(p)}`).join("");
  const fmt = (v: number) => fmtValue(d.family, v);
  return (
    <>
      <div className="legend">
        <span>
          <span className="key" style={{ background: "var(--kalshi)", height: 2 }} />
          Chance it ends above x
        </span>
        <span>
          <span className="key" style={{ background: "var(--kalshi)", opacity: 0.15 }} />
          Middle 50%
        </span>
        <span>
          <span className="key" style={{ background: "var(--text-3)", height: 2 }} />
          Median (dashed)
        </span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Implied distribution: ${d.title}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={y(p) + 4} textAnchor="end" fontSize="12" fill="var(--text-3)">
                {p * 100}%
              </text>
            </g>
          ))}
          {ticks(x0, x1).map((v) => (
            <text key={v} x={x(v)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {fmt(v)}
            </text>
          ))}
          {d.q25 !== null && d.q75 !== null && (
            <rect
              x={x(d.q25)}
              width={Math.max(1, x(d.q75) - x(d.q25))}
              y={PAD.top}
              height={H - PAD.top - PAD.bottom}
              fill="var(--kalshi)"
              fillOpacity={0.12}
            />
          )}
          {d.median !== null && (
            <line
              x1={x(d.median)}
              x2={x(d.median)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--text-3)"
              strokeDasharray="4 4"
            />
          )}
          <path d={line} fill="none" stroke="var(--kalshi)" strokeWidth={2} strokeLinejoin="round" />
          {shown.length <= 60 &&
            shown.map(([v, p]) => (
              <circle key={v} cx={x(v)} cy={y(p)} r={3} fill="var(--kalshi)">
                <title>{`above ${fmt(v)}: ${(p * 100).toFixed(1)}%`}</title>
              </circle>
            ))}
        </svg>
      </div>
    </>
  );
}

/** About six round values across [lo, hi]: steps of 1, 2 or 5 times a power of ten. */
export function ticks(lo: number, hi: number, n = 6): number[] {
  const raw = (hi - lo) / n || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
