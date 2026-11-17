// Volatility term structure for one underlying: each event's implied volatility against its time
// to close (log scale: an hour to a week), one dot per event, colored by venue; for crypto,
// Deribit's at-the-money volatility at the same closes as a line. Plain SVG drawn on the server.
import { ticks } from "@/components/DistChart";
import { utc } from "@/lib/format";
import type { Dist } from "@/lib/distributions";

const W = 420;
const H = 220;
const PAD = { left: 40, right: 12, top: 10, bottom: 28 };
const COLOR: Record<string, string> = { kalshi: "var(--kalshi)", polymarket: "var(--poly)" };
const HOUR_TICKS = [1, 3, 6, 12, 24, 48, 96, 168, 336, 720];

export default function TermChart({ name, dists, now }: { name: string; dists: Dist[]; now: number }) {
  const pts = dists
    .filter((d) => d.vol !== null)
    .map((d) => ({ d, h: (d.close - now) / 3_600_000 }))
    .filter((p) => p.h > 0);
  if (pts.length === 0) return null;
  const deribit = pts
    .filter((p) => p.d.deribitVol !== null)
    .map((p) => ({ h: p.h, v: p.d.deribitVol! }))
    .sort((a, b) => a.h - b.h);
  const hs = pts.map((p) => p.h);
  const h0 = Math.min(...hs) / 1.3;
  const h1 = Math.max(...hs) * 1.3;
  const vs = [...pts.map((p) => p.d.vol!), ...deribit.map((p) => p.v)].map((v) => v * 100);
  const v0 = Math.max(0, Math.floor(Math.min(...vs) / 5) * 5 - 5);
  const v1 = Math.ceil(Math.max(...vs) / 5) * 5 + 5;
  const x = (h: number) =>
    PAD.left + (Math.log(h / h0) / Math.log(h1 / h0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((v1 - v * 100) / (v1 - v0)) * (H - PAD.top - PAD.bottom);
  const line = deribit.map((p, i) => `${i ? "L" : "M"}${x(p.h)},${y(p.v)}`).join("");
  return (
    <div>
      <h3>{name}</h3>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}: implied volatility by time to close`}>
          {ticks(v0, v1, 4).map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v / 100)} y2={y(v / 100)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={y(v / 100) + 4} textAnchor="end" fontSize="12" fill="var(--text-3)">
                {v}%
              </text>
            </g>
          ))}
          {HOUR_TICKS.filter((h) => h >= h0 && h <= h1).map((h) => (
            <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </text>
          ))}
          {line && (
            <path d={line} fill="none" stroke="var(--fair)" strokeWidth={2} strokeLinejoin="round" />
          )}
          {pts.map(({ d, h }) => (
            <circle
              key={`${d.venue}/${d.event}`}
              cx={x(h)}
              cy={y(d.vol!)}
              r={4}
              fill={COLOR[d.venue] ?? "var(--text-2)"}
              stroke="var(--surface)"
              strokeWidth={1.5}
            >
              <title>
                {`${d.title}, closes ${utc(d.close)}: ${(d.vol! * 100).toFixed(1)}%` +
                  (d.deribitVol === null ? "" : ` (Deribit ${(d.deribitVol * 100).toFixed(1)}%)`)}
              </title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  );
}
