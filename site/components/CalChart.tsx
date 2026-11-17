// Calibration (a "reliability diagram"): for each 10¢ bucket of predictions, the average
// prediction (across) against the share that paid out (up). A well-calibrated price sits on the
// diagonal. Marker area grows with the number of contracts; each series has its own shape, so
// colour is never the only cue. Plain SVG, drawn on the server; hover shows each point's numbers.
import type { CalPoint } from "@/lib/stats";

const S = 360;
const PAD = { left: 40, right: 12, top: 12, bottom: 32 };
const W = S + PAD.left + PAD.right;
const H = S + PAD.top + PAD.bottom;

export const SERIES: { who: string; name: string; color: string }[] = [
  { who: "kalshi", name: "Kalshi mid", color: "var(--kalshi)" },
  { who: "polymarket", name: "Polymarket mid", color: "var(--poly)" },
  { who: "fair", name: "Our fair value", color: "var(--fair)" },
];

const x = (p: number) => PAD.left + p * S;
const y = (p: number) => PAD.top + (1 - p) * S;

function Marker({
  who,
  cx,
  cy,
  r,
  color,
}: {
  who: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
}) {
  const ring = {
    stroke: "var(--surface)",
    strokeWidth: 2,
    fill: color,
    fillOpacity: 0.85,
  };
  if (who === "polymarket")
    return (
      <rect
        x={cx - r * 0.89}
        y={cy - r * 0.89}
        width={r * 1.78}
        height={r * 1.78}
        rx={2}
        {...ring}
      />
    );
  if (who === "fair")
    return (
      <path
        d={`M${cx},${cy - r * 1.2}L${cx + r * 1.2},${cy}L${cx},${cy + r * 1.2}L${cx - r * 1.2},${cy}Z`}
        {...ring}
      />
    );
  return <circle cx={cx} cy={cy} r={r} {...ring} />;
}

export function MarkerKey({ who, color }: { who: string; color: string }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      style={{ verticalAlign: "-2px", marginRight: 6 }}
      aria-hidden
    >
      <Marker who={who} cx={7} cy={7} r={5} color={color} />
    </svg>
  );
}

export default function CalChart({ points }: { points: CalPoint[] }) {
  const maxN = Math.max(1, ...points.map((p) => p.n));
  const r = (n: number) => 4 + 8 * Math.sqrt(n / maxN); // area ∝ contracts, at least 8px across
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="chart" style={{ maxWidth: W }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Calibration: predicted chance against the share that paid out"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-3)">
              {t * 100}%
            </text>
            <text x={x(t)} y={H - 14} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {t * 100}¢
            </text>
          </g>
        ))}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="var(--text-3)"
          strokeDasharray="4 4"
        />
        {SERIES.flatMap((s) =>
          points
            .filter((p) => p.who === s.who)
            .map((p) => (
              <g key={`${s.who}${p.bucket}`}>
                <Marker who={s.who} cx={x(p.pred)} cy={y(p.hit)} r={r(p.n)} color={s.color} />
                {/* A larger, invisible hit target carries the hover text. */}
                <circle cx={x(p.pred)} cy={y(p.hit)} r={Math.max(12, r(p.n))} fill="transparent">
                  <title>
                    {`${s.name}, ${p.bucket * 10}–${p.bucket * 10 + 10}¢: said ${(p.pred * 100).toFixed(0)}% on average, ` +
                      `${(p.hit * 100).toFixed(0)}% paid out (${p.n} contracts)`}
                  </title>
                </circle>
              </g>
            )),
        )}
        <text x={x(0.5)} y={H - 1} textAnchor="middle" fontSize="12" fill="var(--text-2)">
          predicted
        </text>
      </svg>
    </div>
  );
}
