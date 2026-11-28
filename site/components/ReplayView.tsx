"use client";
// A past close, minute by minute. The chart follows one contract: its Kalshi bid–ask over time,
// our fair value for Bitcoin, a cursor at the current minute and, past the last minute, how it
// settled. Beside it, every strike at the cursor minute; a click picks the contract to chart.
// A client component for the player; the server sends the whole replay once.
import { useEffect, useState } from "react";
import type { Replay } from "@/lib/replay";
import { fmtValue } from "@/lib/units";

const W = 840;

const STEP_MS = 250; // playback: one recorded minute every quarter second

const usd = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const c = (p: number | null | undefined) => (p == null ? "–" : `${Math.round(p * 100)}¢`);
const qty = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
type Q = Replay["markets"][number]["q"][number];
// A missing side reads as the edge of the range: no bid is 0¢, no ask is 100¢.
const mid = (q: Q) => (q === null ? null : ((q[0] ?? 0) + (q[1] ?? 1)) / 2);

export default function ReplayView({ r }: { r: Replay }) {
  const v = (x: number) => fmtValue(r.family, x); // a strike or the settlement, in its unit
  const last = r.times.length - 1;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Start on the contract closest to an even bet in the first minute: the one most in doubt.
  const [f, setF] = useState(() => {
    const d = r.markets.map((m) => Math.abs((mid(m.q[0]) ?? 2) - 0.5));
    return d.indexOf(Math.min(...d));
  });

  // On a phone the same viewBox is drawn at a third of the width: a taller chart and larger text.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 700px)");
    const set = () => setPhone(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

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

  const m = r.markets[f];
  const q = m.q[i];
  const final = i === last; // the last minute before the close: show how each contract settled
  // The same 840-wide viewBox drawn at 360 px on a phone: taller, with text sized to stay legible.
  const H = phone ? 600 : 300;
  const fs = phone ? 30 : 12;
  const PAD = phone ? { left: 78, right: 64, top: 20, bottom: 44 } : { left: 40, right: 56, top: 12, bottom: 26 };
  const x = (k: number) => PAD.left + (k / (last || 1)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (H - PAD.top - PAD.bottom);
  const bidAsk = m.q.map((s, k) => (s ? { k, bid: s[0] ?? 0, ask: s[1] ?? 1 } : null));
  const band = runs(bidAsk).map(
    (run) =>
      run.map((s) => `${x(s.k)},${y(s.ask)}`).join(" ") +
      " " +
      run.map((s) => `${x(s.k)},${y(s.bid)}`).reverse().join(" "),
  );
  const midPath = runs(bidAsk)
    .map((run) => run.map((s, j) => `${j ? "L" : "M"}${x(s.k)},${y((s.bid + s.ask) / 2)}`).join(""))
    .join("");
  const fairPts = m.fair.map((p, k) => (p === null ? null : { k, p }));
  const fairPath = runs(fairPts)
    .map((run) => run.map((s, j) => `${j ? "L" : "M"}${x(s.k)},${y(s.p)}`).join(""))
    .join("");
  const hasFair = fairPath !== "";
  const lastFair = fairPts.findLast((s) => s !== null);
  const endMid = mid(m.q[last]);
  const yes = m.result === "yes";
  // The ladder: 13 strikes around the one nearest 50¢ this minute (a 6-hour S&P close has 80),
  // plus the charted one. At the last minute that is the line between the yeses and the nos.
  // Two-sided books only, when there are any: in the last minutes a lone 89¢ ask reads as 45¢.
  const twoSided = r.markets.some((k) => k.q[i]?.[0] != null && k.q[i]?.[1] != null);
  const doubt = r.markets.map((k) =>
    twoSided && (k.q[i]?.[0] == null || k.q[i]?.[1] == null) ? 2 : Math.abs((mid(k.q[i]) ?? 2) - 0.5),
  );
  const centre = doubt.indexOf(Math.min(...doubt));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(p * last));

  return (
    <div className="rp">
      <div className="panel rp-main">
        <div className="rp-now num">
          <div>
            <span>Above {v(m.strike)}</span>
            <b>
              {c(q?.[0])} / {c(q?.[1])}
            </b>
          </div>
          <div>
            <span>{hm(r.times[i])} UTC</span>
            <b>{Math.round((r.close - r.times[i]) / 60_000)} min left</b>
          </div>
          {r.index[i] != null && (
            <div>
              <span>Bitcoin</span>
              <b>{usd(r.index[i]!)}</b>
            </div>
          )}
          {hasFair && (
            <div>
              <span>Fair</span>
              <b className="fair">{c(m.fair[i])}</b>
            </div>
          )}
          <div>
            <span>Traded, last min</span>
            <b>{qty(m.traded[i])}</b>
          </div>
          {final && m.result && (
            <div>
              <span>Settled</span>
              <b className={yes ? "up" : "down"}>{yes ? "Yes" : "No"}</b>
            </div>
          )}
        </div>
        <div className="chart">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Above ${v(m.strike)}: Kalshi bid and ask by minute, ${hm(r.times[0])} to ${hm(r.times[last])} UTC`}
            fontSize={fs}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="var(--grid)" />
                <text x={PAD.left - 6} y={y(p) + fs / 3} textAnchor="end" fill="var(--text-3)">
                  {p * 100}¢
                </text>
              </g>
            ))}
            {ticks.map((k, j) => (
              <text
                key={k}
                x={x(k)}
                y={H - (phone ? 8 : 6)}
                textAnchor={j === 0 ? "start" : j === ticks.length - 1 ? "end" : "middle"}
                fill="var(--text-3)"
              >
                {hm(r.times[k])}
              </text>
            ))}
            {band.map((pts, j) => (
              <polygon key={j} points={pts} fill="var(--kalshi)" fillOpacity={0.18} />
            ))}
            <path d={midPath} stroke="var(--kalshi)" strokeWidth={1.5} fill="none" />
            {hasFair && (
              <>
                <path d={fairPath} stroke="var(--fair)" strokeDasharray="3 3" fill="none" />
                {lastFair && (
                  <text x={x(lastFair.k) + 6} y={y(lastFair.p) + fs / 3} fill="var(--fair)">
                    fair
                  </text>
                )}
              </>
            )}
            <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--text)" strokeOpacity={0.5} />
            {final && m.result && endMid !== null && (
              <>
                <line
                  x1={x(last)}
                  x2={W - PAD.right + 16}
                  y1={y(endMid)}
                  y2={y(yes ? 1 : 0)}
                  stroke="var(--text-3)"
                  strokeDasharray="2 3"
                />
                <circle cx={W - PAD.right + 16} cy={y(yes ? 1 : 0)} r={phone ? 8 : 5} fill={yes ? "var(--up)" : "var(--down)"}>
                  <title>{`Settled ${yes ? "yes" : "no"}`}</title>
                </circle>
              </>
            )}
          </svg>
        </div>
        <div className="replay-controls">
          <button
            type="button"
            className="rp-play"
            onClick={() => {
              if (!playing && i >= last) setI(0);
              setPlaying((p) => !p);
            }}
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
      </div>
      <div className="panel">
        <table className="rp-ladder num">
          <thead>
            <tr>
              <th>Above</th>
              <th>Bid</th>
              <th>Ask</th>
              <th aria-label="Midpoint" />
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {r.markets.map((k, j) => {
              if (j !== f && Math.abs(j - centre) > 6) return null;
              const s = k.q[i];
              const md = mid(s);
              return (
                <tr key={k.ticker} className={j === f ? "on" : undefined} onClick={() => setF(j)}>
                  <td>
                    <button type="button" aria-pressed={j === f} onClick={() => setF(j)}>
                      {v(k.strike)}
                    </button>
                  </td>
                  <td>{c(s?.[0])}</td>
                  <td>{c(s?.[1])}</td>
                  <td className="rp-bar">
                    <span style={{ width: `${(md ?? 0) * 100}%` }} />
                  </td>
                  <td>
                    {final && k.result ? (
                      <span className={k.result === "yes" ? "up" : "down"}>{k.result === "yes" ? "Yes" : "No"}</span>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Consecutive non-null stretches, so a gap in the recording is drawn as a gap. */
function runs<T>(xs: (T | null)[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const x of xs) {
    if (x === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(x);
  }
  if (cur.length) out.push(cur);
  return out;
}
