import { connection } from "next/server";
import { Suspense } from "react";
import { price, utc } from "@/lib/format";
import { basis, brier, calibration, gapsByHorizon, gapsByHour, type GapRow } from "@/lib/stats";

export const metadata = { title: "Manta: gap statistics" };

export default function StatsPage() {
  return (
    <>
      <h1>Gap statistics</h1>
      <p className="muted">
        Measured from the snapshots since the tracker started. Every figure says how much data it
        rests on; early on, that is not much.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Gaps />
        <Calibration />
        <Basis />
      </Suspense>
    </>
  );
}

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(0)}%`);
const c1 = (x: number | null) => (x === null ? "–" : (x * 100).toFixed(1));

async function Gaps() {
  await connection(); // request time only: the build never queries the database
  const [horizon, hour] = await Promise.all([gapsByHorizon(), gapsByHour()]);
  return (
    <>
      <h2>How often the two markets disagree</h2>
      <p className="small">
        A disagreement is a snapshot where our fair value is outside Kalshi&apos;s bid–ask: buying
        at Kalshi&apos;s ask or selling at its bid would, by our model, have been a good trade.
        Counted over every snapshot, so these are shares of time, not independent events.
      </p>
      <p className="small">
        Data note: until Nov 13, 23:45 UTC, Kalshi&apos;s bid and ask came from its market list,
        which we later measured trailing the live order book by up to a minute; since then they
        come from the live order book. Early figures overstate disagreement somewhat.
      </p>
      <GapTable label="time to close" rows={horizon} />
      <GapTable label="hour of day (UTC)" rows={hour} />
    </>
  );
}

function GapTable({ label, rows }: { label: string; rows: GapRow[] }) {
  if (rows.length === 0) return <p className="muted">No snapshots yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th>snapshots</th>
            <th>fair outside bid–ask</th>
            <th>by (¢, when outside)</th>
            <th>mean |gap| (¢)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bucket}>
              <td>{r.bucket}</td>
              <td className="num">{r.n.toLocaleString("en-US")}</td>
              <td className="num">{pct(r.outside)}</td>
              <td className="num">{c1(r.by)}</td>
              <td className="num">{c1(r.absGap)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Calibration() {
  await connection();
  const [scores, cal] = await Promise.all([brier(), calibration()]);
  return (
    <>
      <h2>Who was right</h2>
      <p className="small">
        For contracts that have settled: one prediction each at 5, 15, 30 and 60 minutes before the
        close, from Kalshi&apos;s mid and from our fair value, scored against what happened. The
        Brier score is the average of (probability − result)², where the result is 1 or 0: lower is
        better, and always guessing 50¢ scores 0.25. Contracts in one close all settle on the same
        price, so the number of closes is the real sample size.
      </p>
      {scores.length === 0 ? (
        <p className="muted">
          No settled contracts with a prediction 5 or more minutes before their close yet.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>minutes before close</th>
                <th>closes</th>
                <th>contracts</th>
                <th>Kalshi Brier</th>
                <th>fair Brier</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.minutes}>
                  <td>{s.minutes}</td>
                  <td className="num">{s.events}</td>
                  <td className="num">{s.contracts}</td>
                  <td className={`num${s.kalshi < s.fair ? " outside" : ""}`}>
                    {s.kalshi.toFixed(4)}
                  </td>
                  <td className={`num${s.fair < s.kalshi ? " outside" : ""}`}>
                    {s.fair.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cal.events > 0 && (
        <>
          <p className="small">
            Calibration, from {cal.events} closes: when a price said this much, how often did the
            contract pay out? A well-calibrated price pays out about as often as it says.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>price</th>
                  <th>Kalshi: n</th>
                  <th>said</th>
                  <th>paid out</th>
                  <th>fair: n</th>
                  <th>said</th>
                  <th>paid out</th>
                </tr>
              </thead>
              <tbody>
                {cal.rows.map((r) => (
                  <tr key={r.bucket}>
                    <td>
                      {r.bucket * 10}–{r.bucket * 10 + 10}¢
                    </td>
                    <td className="num">{r.kalshiN}</td>
                    <td className="num">{pct(r.kalshiPred)}</td>
                    <td className="num">{pct(r.kalshiHit)}</td>
                    <td className="num">{r.fairN}</td>
                    <td className="num">{pct(r.fairPred)}</td>
                    <td className="num">{pct(r.fairHit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

async function Basis() {
  await connection();
  const rows = await basis();
  const diffs = (pick: (r: (typeof rows)[number]) => number | null) =>
    rows.flatMap((r) => {
      const v = pick(r);
      return v === null ? [] : [v - r.settlement];
    });
  const summary = (d: number[]) => {
    if (d.length === 0) return "–";
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    return `${signed(mean)} on average, typically within ±$${sd.toFixed(2)}`;
  };
  return (
    <>
      <h2>Which price Kalshi settles on</h2>
      <p className="small">
        Kalshi settles on the CF Benchmarks BTC index (BRTI) averaged over the final 60 seconds,
        which isn&apos;t a free feed. Our fair values use Deribit&apos;s index instead. Here each
        settlement is compared with Deribit&apos;s index and Coinbase over the same minute
        (averaged from the snapshots at its start and end). A steady offset would shift every fair
        value near the close.
      </p>
      {rows.length === 0 ? (
        <p className="muted">No settlements yet.</p>
      ) : (
        <>
          <div className="stats">
            <div>
              <span>Deribit index − settlement ({rows.length} closes)</span>
              <b className="num">{summary(diffs((r) => r.index))}</b>
            </div>
            <div>
              <span>Coinbase − settlement</span>
              <b className="num">{summary(diffs((r) => r.coinbase))}</b>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>close</th>
                  <th>Kalshi settlement</th>
                  <th>Deribit − it</th>
                  <th>Coinbase − it</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 24).map((r) => (
                  <tr key={r.close}>
                    <td>{utc(r.close)}</td>
                    <td className="num">{price(r.settlement)}</td>
                    <td className="num">{r.index === null ? "–" : signed(r.index - r.settlement)}</td>
                    <td className="num">
                      {r.coinbase === null ? "–" : signed(r.coinbase - r.settlement)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const signed = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;
