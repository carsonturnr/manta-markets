// The home page's chart: one strike ladder read as "the chance it ends above each price". The
// market's curve in grey, Manta's fair value as a mint dot at each strike, and a thin
// mint line where the two are 3 points or more apart. Plain SVG drawn on the server; the
// viewBox is close to its size on screen, so its text stays at its real size.
import { mid, usableFair } from "@/lib/outcomes";
import type { Row } from "@/lib/screener";
import { fmtValue } from "@/lib/units";

/** A smooth path through points that rise or fall in one direction, without overshooting them
 * (monotone cubic interpolation, Fritsch and Carlson 1980): a probability curve that can't bulge
 * past 100% or wiggle between strikes. */
function smooth(p: [number, number][]): string {
  const n = p.length;
  const d = p.slice(1).map(([x, y], i) => (y - p[i][1]) / (x - p[i][0])); // slope of each segment
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      m[i] = (3 * a * d[i]) / Math.sqrt(h);
      m[i + 1] = (3 * b * d[i]) / Math.sqrt(h);
    }
  }
  let path = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (p[i + 1][0] - p[i][0]) / 3;
    path +=
      `C${(p[i][0] + dx).toFixed(1)},${(p[i][1] + m[i] * dx).toFixed(1)} ` +
      `${(p[i + 1][0] - dx).toFixed(1)},${(p[i + 1][1] - m[i + 1] * dx).toFixed(1)} ` +
      `${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return path;
}

const W = 1000;
const H = 400;
const PAD = { left: 44, right: 16, top: 16, bottom: 36 };

export default function HeroChart({ outcomes, family }: { outcomes: Row[]; family: string }) {
  // The strikes still in play (2% to 98%), plus one either side to anchor the ends.
  const all = outcomes
    .filter((o) => o.payoff === "above" && o.low !== null && mid(o) !== null)
    .sort((a, b) => a.low! - b.low!);
  const live = all.findIndex((o) => mid(o)! < 0.98);
  const last = all.findLastIndex((o) => mid(o)! > 0.02);
  const pts = all.slice(Math.max(0, live - 1), Math.min(all.length, last + 2));
  if (pts.length < 3) return null;

  const x0 = pts[0].low!;
  const x1 = pts.at(-1)!.low!;
  const x = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const line = smooth(pts.map((o) => [x(o.low!), y(mid(o)!)]));
  const area = `${line}L${x(x1)},${y(0)}L${x(x0)},${y(0)}Z`;
  // The strike where Manta and the market disagree most, for a callout.
  const widest = pts
    .filter((o) => usableFair(o) !== null)
    .sort((a, b) => Math.abs(usableFair(b)! - mid(b)!) - Math.abs(usableFair(a)! - mid(a)!))[0];
  // Where the market's curve crosses 50%: even odds, the market's middle guess.
  const k = pts.findIndex((o) => mid(o)! < 0.5);
  const even =
    k > 0
      ? pts[k - 1].low! +
        ((mid(pts[k - 1])! - 0.5) / (mid(pts[k - 1])! - mid(pts[k])!)) * (pts[k].low! - pts[k - 1].low!)
      : null;
  const every = Math.ceil(pts.length / 6); // label about six strikes

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hero-chart" role="img" aria-label="The chance Bitcoin closes above each price: the market's prices and Manta's fair values">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} className="grid" />
          <text x={PAD.left - 10} y={y(p) + 4} textAnchor="end" className="tick">
            {p * 100}%
          </text>
        </g>
      ))}
      <defs>
        {/* The fill fades from the market's colour to nothing, so the curve reads first. */}
        <linearGradient id="hero-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--ink)", stopOpacity: 0.16 }} />
          <stop offset="100%" style={{ stopColor: "var(--ink)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#hero-fill)" />
      {even !== null && (
        <g>
          <line x1={x(even)} x2={x(even)} y1={y(1)} y2={y(0)} className="even" />
          <text x={x(even) + 8} y={y(1) + 12} className="even-label">
            Even odds {fmtValue(family, even)}
          </text>
        </g>
      )}
      <path d={line} className="market" />
      {pts.map((o) => {
        const m = mid(o)!;
        const f = usableFair(o);
        const gap = f === null ? 0 : f - m;
        return (
          <g key={o.id}>
            {f !== null && Math.abs(gap) >= 0.03 && (
              <line x1={x(o.low!)} x2={x(o.low!)} y1={y(m)} y2={y(f)} className="gap" />
            )}
            <circle cx={x(o.low!)} cy={y(m)} r="2.5" className="dot" />
            {f !== null && (
              <circle cx={x(o.low!)} cy={y(f)} r="4" className="buoy">
                {/* One string: an SVG title split across JSX pieces hydrates differently. */}
                <title>{`Above ${fmtValue(family, o.low!)}: market ${Math.round(m * 100)}%, Manta ${Math.round(f * 100)}%`}</title>
              </circle>
            )}
          </g>
        );
      })}
      {widest && Math.abs(usableFair(widest)! - mid(widest)!) >= 0.03 && (
        <Callout
          x={x(widest.low!)}
          y={Math.min(y(usableFair(widest)!), y(mid(widest)!))}
          text={`Manta ${usableFair(widest)! > mid(widest)! ? "+" : "−"}${(Math.abs(usableFair(widest)! - mid(widest)!) * 100).toFixed(1)} pts`}
          right={x(widest.low!) < W * 0.7}
        />
      )}
      {pts.map((o, i) =>
        i % every === 0 ? (
          <text key={o.id} x={x(o.low!)} y={H - 12} textAnchor="middle" className="tick">
            {fmtValue(family, o.low!)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** A label for the widest gap, on a short leader line above the point. */
function Callout({ x, y, text, right }: { x: number; y: number; text: string; right: boolean }) {
  const lx = right ? x + 28 : x - 28;
  return (
    <g className="callout-mark">
      <polyline points={`${x},${y - 8} ${x},${y - 28} ${lx},${y - 28}`} />
      <text x={right ? lx + 6 : lx - 6} y={y - 24} textAnchor={right ? "start" : "end"}>
        {text}
      </text>
    </g>
  );
}
