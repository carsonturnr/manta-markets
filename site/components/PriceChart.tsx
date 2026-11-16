"use client";
// A contract's price over time, as plain SVG (the pattern of GapChart): Kalshi's bid–ask band,
// or Polymarket's single price line (its history has no bid and ask). A client component only for
// the hover crosshair.
import { useState } from "react";
import type { Point } from "@/lib/venues";

const W = 840;
const H = 280;
const PAD = { left: 40, right: 16, top: 12, bottom: 28 };

export default function PriceChart({
  points,
  venue,
  days,
}: {
  points: Point[];
  venue: "kalshi" | "polymarket";
  days: boolean; // label the x axis with dates rather than times
}) {
  const [hover, setHover] = useState<number | null>(null);
  const band = venue === "kalshi";
  const color = band ? "var(--kalshi)" : "var(--poly)";

  const t0 = points[0].t;
  const t1 = Math.max(points.at(-1)!.t, t0 + 60_000);
  const ys = points.flatMap((p) => [p.bid, p.ask, p.price].filter((v) => v !== undefined));
  const lo = Math.max(0, Math.floor((Math.min(...ys) * 100 - 2) / 5) * 5);
  const hi = Math.min(100, Math.ceil((Math.max(...ys) * 100 + 2) / 5) * 5);
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + ((hi - p * 100) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  // Kalshi: along the asks left to right, back along the bids. Polymarket: one line.
  const path = band
    ? points.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.ask!)}`).join("") +
      [...points]
        .reverse()
        .map((p) => `L${x(p.t)},${y(p.bid!)}`)
        .join("") +
      "Z"
    : points.map((p, i) => `${i ? "L" : "M"}${x(p.t)},${y(p.price!)}`).join("");

  const step = Math.max(5, Math.ceil((hi - lo) / 6 / 5) * 5);
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(v);
  const xTicks = timeTicks(t0, t1);
  const label = (t: number) =>
    days
      ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : new Date(t).toISOString().slice(11, 16);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
    let bestI = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs(points[bestI].t - t)) bestI = i;
    });
    setHover(bestI);
  }

  const h = hover === null ? null : points[hover];
  const c = (v: number) => `${Math.round(v * 1000) / 10}¢`;
  return (
    <>
      <div className="legend">
        <span>
          <span
            className="key"
            style={band ? { background: color, opacity: 0.35 } : { background: color, height: 2 }}
          />
          {band ? "Kalshi bid–ask for “yes”" : "Polymarket price for “yes”"}
        </span>
      </div>
      <div className="chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={band ? "Bid–ask band over time, in cents" : "Price over time, in cents"}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v / 100)}
                y2={y(v / 100)}
                stroke="var(--grid)"
              />
              <text
                x={PAD.left - 6}
                y={y(v / 100) + 4}
                textAnchor="end"
                fontSize="12"
                fill="var(--text-3)"
              >
                {v}¢
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {label(t)}
            </text>
          ))}
          {band ? (
            <path d={path} fill={color} fillOpacity={0.3} />
          ) : (
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          )}
          {h && (
            <line x1={x(h.t)} x2={x(h.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-3)" />
          )}
        </svg>
        {h && (
          <div
            className="tip num"
            style={
              x(h.t) > W / 2
                ? { right: `${100 - (x(h.t) / W) * 100 + 2}%` }
                : { left: `${(x(h.t) / W) * 100 + 2}%` }
            }
          >
            {new Date(h.t).toISOString().slice(5, 16).replace("T", " ")} UTC
            <br />
            {band ? `bid ${c(h.bid!)} · ask ${c(h.ask!)}` : `price ${c(h.price!)}`}
          </div>
        )}
      </div>
    </>
  );
}

/** Round times for the x axis (UTC): the smallest step from 15 min to 1 day giving ≤ 7 labels. */
function timeTicks(t0: number, t1: number): number[] {
  const min = 60_000;
  const every =
    [15, 30, 60, 120, 240, 360, 720, 1440].map((m) => m * min).find((s) => (t1 - t0) / s <= 7) ??
    2880 * min;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) out.push(t);
  return out;
}
