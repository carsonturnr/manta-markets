"use client";
// Kalshi's bid–ask band and our fair value over time, as plain SVG. A client component only for
// the hover crosshair: the server sends the points, the browser draws and tracks the pointer.
import { useState } from "react";
import type { Point } from "@/lib/queries";

const W = 840;
const H = 320;
const PAD = { left: 40, right: 16, top: 12, bottom: 28 };
const MAX_STEP_MS = 3 * 60_000; // snapshots further apart than this are a gap in the data

export default function GapChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  // y range: the data's range in cents, padded and rounded out to 5¢, inside 0–100.
  const ys = points.flatMap((p) => [p.bid, p.ask, ...(p.fair === null ? [] : [p.fair])]);
  const lo = Math.max(0, Math.floor((Math.min(...ys) * 100 - 2) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...ys) * 100 + 2) / 5) * 5);

  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + ((hi - p * 100) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  // Split into stretches without missing snapshots: a gap is drawn as a gap, never bridged.
  const segments: Point[][] = [];
  points.forEach((p, i) => {
    if (i === 0 || p.t - points[i - 1].t > MAX_STEP_MS) segments.push([]);
    segments.at(-1)!.push(p);
  });
  // The band: along the asks left to right, back along the bids right to left.
  const band = segments
    .map(
      (seg) =>
        seg.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.ask)}`).join("") +
        [...seg]
          .reverse()
          .map((p) => `L${x(p.t)},${y(p.bid)}`)
          .join("") +
        "Z",
    )
    .join("");
  // Fair value as a line, also broken where it's missing (the final 60 seconds).
  let fairPath = "";
  points.forEach((p, i) => {
    if (p.fair === null) return;
    const prev = points[i - 1];
    const move = i === 0 || prev.fair === null || p.t - prev.t > MAX_STEP_MS;
    fairPath += `${move ? "M" : "L"}${x(p.t)},${y(p.fair)}`;
  });

  const step = Math.max(5, Math.ceil((hi - lo) / 6 / 5) * 5);
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(v);
  const xTicks = timeTicks(t0, t1);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W; // pointer x in viewBox units
    const t = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i;
    });
    setHover(best);
  }

  const h = hover === null ? null : points[hover];
  return (
    <>
      <div className="legend">
        <span>
          <span className="key" style={{ background: "var(--kalshi)", opacity: 0.35 }} />
          Kalshi bid–ask
        </span>
        <span>
          <span className="key" style={{ background: "var(--fair)", height: 2 }} />
          Fair value (options)
        </span>
        <span>
          <span className="key" style={{ background: "var(--up)", opacity: 0.5 }} />
          fair above the ask
        </span>
        <span>
          <span className="key" style={{ background: "var(--down)", opacity: 0.5 }} />
          fair below the bid
        </span>
      </div>
      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Kalshi bid–ask band and fair value over time, in cents"
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v / 100)} y2={y(v / 100)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={y(v / 100) + 4} textAnchor="end" fontSize="12" fill="var(--text-3)">
                {v}¢
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {new Date(t).toISOString().slice(11, 16)}
            </text>
          ))}
          <path d={band} fill="var(--kalshi)" fillOpacity={0.25} />
          {/* The gap, wherever fair value is outside the band: a tint from the band's edge to it. */}
          {points.map((p) =>
            p.fair === null || (p.fair >= p.bid && p.fair <= p.ask) ? null : (
              <line
                key={p.t}
                x1={x(p.t)}
                x2={x(p.t)}
                y1={y(p.fair)}
                y2={y(p.fair > p.ask ? p.ask : p.bid)}
                stroke={p.fair > p.ask ? "var(--up)" : "var(--down)"}
                strokeOpacity={0.35}
                strokeWidth={Math.max(1, (W - PAD.left - PAD.right) / points.length)}
              />
            ),
          )}
          <path d={fairPath} fill="none" stroke="var(--fair)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <g>
              <line x1={x(h.t)} x2={x(h.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-3)" />
              {h.fair !== null && (
                <circle cx={x(h.t)} cy={y(h.fair)} r={4} fill="var(--fair)" stroke="var(--surface)" strokeWidth={2} />
              )}
            </g>
          )}
        </svg>
        {h && (
          <div
            className="tip num"
            style={x(h.t) > W / 2 ? { right: `${100 - (x(h.t) / W) * 100 + 2}%` } : { left: `${(x(h.t) / W) * 100 + 2}%` }}
          >
            {new Date(h.t).toISOString().slice(11, 16)} UTC
            <br />
            Kalshi {(h.bid * 100).toFixed(0)}–{(h.ask * 100).toFixed(0)}¢
            <br />
            fair {h.fair === null ? "–" : (h.fair * 100).toFixed(1) + "¢"}
            <br />
            BTC ${h.index.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </div>
        )}
      </div>
    </>
  );
}

/** Round times for the x axis (UTC): the smallest of 5 min to 4 h that gives ≤ 7 labels. */
function timeTicks(t0: number, t1: number): number[] {
  const min = 60_000;
  const every = [5, 10, 15, 30, 60, 120, 240].map((m) => m * min).find((s) => (t1 - t0) / s <= 7) ?? 360 * min;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) out.push(t);
  return out;
}
