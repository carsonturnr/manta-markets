"use client";
// A past close, minute by minute: each strike's Kalshi bid–ask as a bar and our fair value as a
// dot, Bitcoin's price as a vertical line, and after the close the settlement value. A client
// component for the slider and play button; the server sends the whole replay once.
import { useEffect, useState } from "react";
import type { Replay } from "@/lib/replay";

const W = 840;
const H = 320;
const PAD = { left: 40, right: 16, top: 12, bottom: 28 };
const STEP_MS = 250; // playback: one recorded minute every quarter second

const usd = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const c = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
const qty = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

export default function ReplayView({ r }: { r: Replay }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = r.times.length - 1;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setI((k) => {
        if (k >= last) {
          setPlaying(false);
          return k;
        }
        return k + 1;
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, last]);

  const t = r.times[i];
  const s0 = r.markets[0]?.strike ?? 0;
  const s1 = r.markets.at(-1)?.strike ?? 1;
  const x = (s: number) => PAD.left + ((s - s0) / (s1 - s0 || 1)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const index = r.index[i];
  const shown = r.markets.filter((m) => m.strike >= s0 && m.strike <= s1);
  const minuteTrades = r.trades.filter((tr) => tr.t >= t - 60_000 && tr.t < t);
  const tradesBy = new Map<number, { n: number; sz: number }>();
  for (const tr of minuteTrades) {
    const a = tradesBy.get(tr.m) ?? { n: 0, sz: 0 };
    tradesBy.set(tr.m, { n: a.n + 1, sz: a.sz + tr.sz });
  }
  const toClose = Math.round((r.close - t) / 60_000);
  const final = i === last; // the last minute before the close: show how it settled
  const active = r.markets
    .map((m, k) => ({ m, k, q: m.q[i] }))
    .filter(({ q }) => q !== null && ((q[0] ?? 0) + (q[1] ?? 1)) / 2 >= 0.03 && ((q[0] ?? 0) + (q[1] ?? 1)) / 2 <= 0.97);

  return (
    <>
      <div className="replay-controls">
        <button
          type="button"
          onClick={() => {
            if (!playing && i >= last) setI(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : i >= last ? "Replay" : "Play"}
        </button>
        <button type="button" onClick={() => setI((k) => Math.max(0, k - 1))} aria-label="One minute back">
          −1 min
        </button>
        <button type="button" onClick={() => setI((k) => Math.min(last, k + 1))} aria-label="One minute forward">
          +1 min
        </button>
        <input
          type="range"
          min={0}
          max={last}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          aria-label="Minute"
        />
      </div>
      <p className="num">
        <strong>{hm(t)} UTC</strong> · {toClose} min to the close
        {index !== null && <> · Bitcoin {usd(index)} (Deribit index)</>}
        {final && r.settlement !== null && <> · then settled on {usd(r.settlement)}</>}
      </p>
      <div className="legend">
        <span>
          <span className="key" style={{ background: "var(--kalshi)", opacity: 0.6 }} />
          Kalshi bid–ask per strike
        </span>
        <span>
          <span className="key" style={{ background: "var(--fair)", borderRadius: 5, width: 10 }} />
          Fair value (options)
        </span>
        <span>
          <span className="key" style={{ background: "var(--text-3)", height: 2 }} />
          Bitcoin now{r.settlement !== null && ", dashed: settlement"}
        </span>
      </div>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Kalshi prices by strike at ${hm(t)} UTC`}>
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="var(--grid)" />
              <text x={PAD.left - 6} y={y(p) + 4} textAnchor="end" fontSize="12" fill="var(--text-3)">
                {p * 100}¢
              </text>
            </g>
          ))}
          {strikeTicks(s0, s1).map((s) => (
            <text key={s} x={x(s)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-3)">
              {usd(s)}
            </text>
          ))}
          {index !== null && index >= s0 && index <= s1 && (
            <line x1={x(index)} x2={x(index)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text-3)" />
          )}
          {final && r.settlement !== null && r.settlement >= s0 && r.settlement <= s1 && (
            <line
              x1={x(r.settlement)}
              x2={x(r.settlement)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--text-3)"
              strokeDasharray="4 4"
            />
          )}
          {shown.map((m) => {
            const q = m.q[i];
            const f = m.fair[i];
            const bid = q?.[0] ?? 0;
            const ask = q?.[1] ?? 1;
            return (
              <g key={m.ticker}>
                {q && (
                  <rect
                    x={x(m.strike) - 2}
                    width={4}
                    y={y(ask)}
                    height={Math.max(2, y(bid) - y(ask))}
                    fill="var(--kalshi)"
                    fillOpacity={0.6}
                  >
                    <title>{`above ${usd(m.strike)}: bid ${c(q[0])}, ask ${c(q[1])}`}</title>
                  </rect>
                )}
                {f !== null && <circle cx={x(m.strike)} cy={y(f)} r={3} fill="var(--fair)" />}
              </g>
            );
          })}
        </svg>
      </div>

      <h3>Contracts in play at {hm(t)}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pays if above</th>
              <th>Bid (size)</th>
              <th>Ask (size)</th>
              <th>Fair</th>
              <th>Trades in the minute</th>
              <th>Settled</th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing between 3¢ and 97¢ this minute.
                </td>
              </tr>
            )}
            {active.map(({ m, k, q }) => (
              <tr key={m.ticker}>
                <td className="num">{usd(m.strike)}</td>
                <td className="num">
                  {c(q![0])} <span className="muted">({qty(q![2])})</span>
                </td>
                <td className="num">
                  {c(q![1])} <span className="muted">({qty(q![3])})</span>
                </td>
                <td className="num">{c(m.fair[i])}</td>
                <td className="num">
                  {tradesBy.get(k) ? `${tradesBy.get(k)!.n} · ${qty(tradesBy.get(k)!.sz)} contracts` : "–"}
                </td>
                <td>{final && m.result ? m.result : <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** About six round dollar strikes across the range. */
function strikeTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 6 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
