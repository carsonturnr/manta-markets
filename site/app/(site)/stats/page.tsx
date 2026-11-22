import { connection } from "next/server";
import { Suspense } from "react";
import { price, utc } from "@/lib/format";
import CalChart, { MarkerKey, SERIES } from "@/components/CalChart";
import { FAMILIES } from "@/lib/families";
import { score, type EventScore } from "@/lib/scoring";
import {
  basis,
  brier,
  calibration,
  calibrationAll,
  eventScores,
  gapsByHorizon,
  gapsByHour,
  type GapRow,
} from "@/lib/stats";

export const metadata = { title: "Manta: accuracy" };

export default function StatsPage() {
  return (
    <>
      <h1>Accuracy</h1>
      <p className="muted">
        How well each venue&apos;s prices and our fair values predicted what happened. Every figure
        says how much data it rests on; early on, that is not much.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Accuracy />
        <h2>Kalshi Bitcoin in detail</h2>
        <p className="muted">
          The sections below come from the Bitcoin tracker&apos;s minute-by-minute snapshots.
        </p>
        <Gaps />
        <Calibration />
        <Basis />
      </Suspense>
    </>
  );
}

const HORIZONS: [number, string][] = [
  [5, "5 min"],
  [60, "1 hour"],
  [1440, "1 day"],
  [10080, "1 week"],
];
const CATEGORY = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.category]));
const VENUE_NAME: Record<string, string> = {
  kalshi: "Kalshi",
  polymarket: "Polymarket",
};
const b4 = (x: number | null) => (x === null || Number.isNaN(x) ? "–" : x.toFixed(4));

async function Accuracy() {
  await connection(); // request time only: the build never queries the database
  const [rows, cal] = await Promise.all([eventScores(), calibrationAll()]);
  // One line per venue, category and horizon.
  const groups = new Map<string, EventScore[]>();
  for (const r of rows) {
    const cat = CATEGORY.get(`${r.venue}/${r.family}`) ?? "Other";
    const k = `${cat}|${r.venue}|${r.horizon}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const order = ["Crypto", "Financials", "Economics", "Other"];
  const lines = [...groups.entries()]
    .map(([k, rs]) => {
      const [cat, venue, h] = k.split("|");
      return { cat, venue, horizon: Number(h), s: score(rs) };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.cat) - order.indexOf(b.cat) ||
        a.venue.localeCompare(b.venue) ||
        a.horizon - b.horizon,
    );
  return (
    <>
      <h2>Who was right</h2>
      <p className="small">
        For every settled contract, one prediction at each of 5 minutes, 1 hour, 1 day and 1 week
        before it was decided (when it was listed that early): the venue&apos;s mid (halfway between
        bid and ask) and our fair value, scored against what happened. The Brier score is the
        average of (probability − result)², where the result is 1 if the contract paid out and 0 if
        not: lower is better, and always guessing 50¢ scores 0.25. Only contracts in play are scored
        (the mid or fair value between 3¢ and 97¢); the rest are all but decided and would flatter
        every score.
      </p>
      <p className="small">
        Contracts of one close are decided by the same number and win or lose together, so the
        sample size that counts is the number of closes. The last column is our fair value&apos;s
        score minus the venue&apos;s, on the same contracts: negative means ours was better. Its
        range comes from resampling whole closes 1,000 times and keeping the middle 90% of the
        results; a range that includes zero means no measurable difference. It needs at least 5
        closes. Each horizon scores a different set of contracts (an hour out, more strikes are in
        play), so compare scores across a row, not down a column.
      </p>
      <p className="small">
        Fair values for Bitcoin and Ether come from Deribit&apos;s options, independent of the
        venue. Everywhere else they are a consensus of the venues&apos; own order books, so they can
        only differ from the venue&apos;s mid by smoothing it or by drawing on the other venue:
        expect little difference there. Polymarket&apos;s economics markets keep trading after the
        figure is published, so they are timed from the paired Kalshi contract&apos;s close.
        Predictions are stored from 2026-11-17; Kalshi&apos;s Bitcoin contracts go back to
        2026-11-14 from the tracker&apos;s history.
      </p>
      {lines.length === 0 ? (
        <p className="muted">No settled predictions yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>venue, category</th>
                <th>before decided</th>
                <th>closes</th>
                <th>contracts</th>
                <th>venue Brier</th>
                <th>fair method</th>
                <th>venue Brier (same contracts)</th>
                <th>fair Brier</th>
                <th>fair − venue, 90% range</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ cat, venue, horizon, s }) => (
                <tr key={`${cat}${venue}${horizon}`}>
                  <td>
                    {VENUE_NAME[venue] ?? venue} {cat.toLowerCase()}
                  </td>
                  <td>{HORIZONS.find(([m]) => m === horizon)?.[1] ?? `${horizon} min`}</td>
                  <td className="num">{s.events}</td>
                  <td className="num">{s.n.toLocaleString("en-US")}</td>
                  <td className="num">{b4(s.venue)}</td>
                  <td>{s.nFair === 0 ? "–" : cat === "Crypto" ? "options" : "book consensus"}</td>
                  <td className="num">{b4(s.venueF)}</td>
                  <td className="num">{b4(s.fair)}</td>
                  <td className="num">
                    {s.diff === null ? (
                      <span className="muted">
                        {s.nFair === 0 ? "–" : `${s.fairEvents} closes`}
                      </span>
                    ) : (
                      `${signedB(s.diff[0])} to ${signedB(s.diff[1])}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cal.events > 0 && (
        <>
          <h3>Calibration</h3>
          <p className="small">
            When a price said this much, how often did the contract pay out? From {cal.events}{" "}
            closes, every horizon pooled. A well-calibrated price sits on the dashed diagonal: of
            contracts priced around 30¢, about 30% pay out. Marker size grows with the number of
            contracts; hover for the numbers.
          </p>
          <div className="legend">
            {SERIES.map((s) => (
              <span key={s.who}>
                <MarkerKey who={s.who} color={s.color} />
                {s.name}
              </span>
            ))}
          </div>
          <CalChart points={cal.points} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>price</th>
                  {SERIES.map((s) => (
                    <th key={s.who}>{s.name}: n · said · paid out</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, b) => (
                  <tr key={b}>
                    <td>
                      {b * 10}–{b * 10 + 10}¢
                    </td>
                    {SERIES.map((s) => {
                      const p = cal.points.find((q) => q.who === s.who && q.bucket === b);
                      return (
                        <td key={s.who} className="num">
                          {p ? `${p.n} · ${pct(p.pred)} · ${pct(p.hit)}` : "–"}
                        </td>
                      );
                    })}
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

const signedB = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(4)}`;

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
