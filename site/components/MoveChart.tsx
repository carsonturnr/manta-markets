// One contract's midpoint around a release (15 minutes before to 30 after) or a news item
// (`before` = 30, the baseline window), with t0 marked. Drawn as steps: each mid holds until the
// next change. Plain SVG on the server, in GapChart's style.
const W = 420;
const H = 180;
const PAD = { left: 36, right: 10, top: 10, bottom: 24 };
const MIN = 60_000;

export default function MoveChart({ mids, t0, label, before = 15, what = "the release" }: { mids: [number, number][]; t0: number; label: string; before?: number; what?: string }) {
  const from = t0 - before * MIN;
  const to = t0 + 30 * MIN;
  if (mids.length === 0) return <p className="small">No midpoint recorded in the window.</p>;
  const ys = mids.map(([, m]) => m);
  const lo = Math.max(0, Math.floor(Math.min(...ys) - 1));
  const hi = Math.min(100, Math.ceil(Math.max(...ys) + 1));
  const x = (t: number) => PAD.left + ((t - from) / (to - from)) * (W - PAD.left - PAD.right);
  const y = (c: number) => PAD.top + ((hi - c) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  let path = `M${x(mids[0][0])},${y(mids[0][1])}`;
  for (let i = 1; i < mids.length; i++) path += `H${x(mids[i][0])}V${y(mids[i][1])}`;
  path += `H${x(Math.max(to, mids.at(-1)![0]))}`;
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(v);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: midpoint in cents, ${before} minutes before to 30 after ${what}`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {v}¢
            </text>
          </g>
        ))}
        {[-before, ...(before > 15 ? [-15] : []), 0, 15, 30].map((m) => (
          <text key={m} x={x(t0 + m * MIN)} y={H - 6} textAnchor={m === 30 ? "end" : "middle"} fontSize="11" fill={m === 0 ? "var(--mint)" : "var(--text-3)"}>
            {m === 0 ? "t0" : `${m > 0 ? "+" : "−"}${Math.abs(m)} min`}
          </text>
        ))}
        <line x1={x(t0)} x2={x(t0)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--mint)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
