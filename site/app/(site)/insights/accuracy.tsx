// Insights: how accurate the market prices are. Folded in from the old /stats page (2026-11-26):
// the answer is the calibration chart of the venues' own prices; fair value against them is one
// line, and every score, range and the Kalshi Bitcoin detail sit under "More".
import { connection } from "next/server";
import CalChart, { MarkerKey, SERIES } from "@/components/CalChart";
import { FAMILIES } from "@/lib/families";
import { price, utc } from "@/lib/format";
import { score, type EventScore, type Score } from "@/lib/scoring";
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
import { calibrationMiss, headline, type Line, verdict } from "@/lib/stats-view";

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

export default async function Accuracy() {
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
  const lead = headline(lines);
  const miss = calibrationMiss(cal.points, ["kalshi", "polymarket"]);
  if (cal.events === 0 || !miss) return <p className="muted">Not enough settled closes yet.</p>;
  return (
    <>
      <p className="insight-says">
        {miss.miss < 0.05 ? "Market prices work as honest odds" : "Market prices are rough odds"}: across{" "}
        <b className="num">{n0(miss.n)}</b> predictions from <b className="num">{n0(cal.events)}</b>{" "}
        settled closes, the share that paid out was on average{" "}
        <b className="num">{(miss.miss * 100).toFixed(1)} points</b> from what the price said.
      </p>
      <section className="panel stack">
        <header className="ph">
          <h3>Price said against share that paid out</h3>
          <span className="right m3">every horizon pooled</span>
        </header>
        <div className="pad insight-pair">
          <div>
          <div className="legend">
            {SERIES.map((s) => (
              <span key={s.who}>
                <MarkerKey who={s.who} color={s.color} />
                {s.name}
              </span>
            ))}
          </div>
          <CalChart points={cal.points} />
          </div>
        <p className="note">
          <b>Calibration</b>: when a price said 30¢, about 30% of those contracts should pay out, so a
          well-calibrated price sits on the dashed diagonal. Each marker is a 10¢ bucket; its size
          grows with the number of contracts (hover for the numbers). One prediction per contract
          at each of 5 minutes, 1 hour, 1 day and 1 week before it was decided, only while in play
          (3¢ to 97¢). Contracts of one close win or lose together, so the sample that counts is
          the {n0(cal.events)} closes, not the contracts.
        </p>
        </div>
      </section>
      {lead && <FairLine line={lead} />}
      <details className="more">
        <summary>More: every score with its uncertainty, and the Kalshi Bitcoin detail</summary>
        <Forest lines={lines} />
      <h3>Accuracy by venue, category and horizon</h3>
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
      <h3>Calibration, bucket by bucket</h3>
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
      <h3>Kalshi Bitcoin in detail</h3>
      <p className="muted">
        The sections below come from the Bitcoin tracker&apos;s minute-by-minute snapshots.
      </p>
      <Gaps />
      <Calibration />
      <Basis />
      </details>
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
      <h4>How often fair value sits outside Kalshi&apos;s bid–ask</h4>
      <p className="small">
        Each snapshot where our fair value is above Kalshi&apos;s ask or below its bid counts.
        Counted over every snapshot, so these are shares of time, not independent events.
      </p>
      <p className="small">
        Data note: until Nov 13, 23:45 UTC, Kalshi&apos;s bid and ask came from its market list,
        which we later measured trailing the live order book by up to a minute; since then they
        come from the live order book. Early figures overstate these shares somewhat.
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
      <h4>Accuracy in the last hour</h4>
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
      <h4>Which price Kalshi settles on</h4>
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

const HORIZON_WORDS: Record<number, string> = {
  5: "five minutes before the close",
  60: "an hour before the close",
  1440: "a day before the close",
  10080: "a week before the close",
};
const CAT_WORDS: Record<string, string> = {
  Crypto: "Bitcoin and Ether",
  Economics: "economics",
  Financials: "stock indexes and currencies",
};
const n0 = (x: number) => x.toLocaleString("en-US");

/** Fair value against the venue's own price, in one line. */
function FairLine({ line }: { line: Line }) {
  const { s, venue, horizon, cat } = line;
  const v = verdict(s)!;
  const name = VENUE_NAME[venue] ?? venue;
  const by = `${Math.abs(v.pct).toFixed(1)}%`;
  return (
    <p className="insight-says">
      Manta&apos;s own fair value, one tool among the others: {HORIZON_WORDS[horizon] ?? `${horizon} minutes before the close`}{" "}
      on {CAT_WORDS[cat] ?? cat.toLowerCase()}, it was{" "}
      {v.kind === "same" ? (
        <>about as accurate as {name}&apos;s price ({by} {v.pct >= 0 ? "better" : "worse"}, within chance)</>
      ) : (
        <b className={v.kind === "better" ? "up" : "down"}>
          {by} {v.kind === "better" ? "more" : "less"} accurate than {name}&apos;s price
        </b>
      )}{" "}
      over <b className="num">{n0(s.fairEvents)}</b> closes ({n0(s.nFair)} contracts; Brier{" "}
      {s.fair!.toFixed(4)} against {s.venueF!.toFixed(4)}).
    </p>
  );
}

/** Every comparison with enough closes for a range: Manta's fair value against the venue's price
 *  on the same contracts, as a share of the venue's score, with its 90% range. Left of zero,
 *  Manta's fair value was more accurate; a range across zero is no measurable difference. */
function Forest({ lines }: { lines: Line[] }) {
  const rows = lines.filter((l) => l.s.diff !== null && l.s.venueF);
  if (rows.length === 0) return null;
  const rel = (x: number, s: Score) => (x / s.venueF!) * 100; // Brier difference as % of the venue's
  // Scale to the widest range, but at most ±50%: a 5-close range would flatten the rest.
  const reach = Math.min(
    50,
    Math.max(5, ...rows.flatMap((l) => l.s.diff!.map((d) => Math.abs(rel(d, l.s))))),
  );
  const pos = (p: number) => `${50 + (Math.max(-reach, Math.min(reach, p)) / reach) * 50}%`;
  return (
    <section className="panel stack">
      <header className="ph">
        <h3>Every comparison, with its uncertainty</h3>
        <span className="right m3">fair value against the venue&apos;s price</span>
      </header>
      <div className="pad forest">
        <div className="forest-row forest-axis small m3">
          <span />
          <span className="forest-track">
            <span style={{ left: 0 }}>← Manta more accurate</span>
            <span style={{ left: "50%", transform: "translateX(-50%)" }}>no difference</span>
            <span style={{ right: 0 }}>venue more accurate →</span>
          </span>
          <span>closes</span>
        </div>
        {rows.map((l) => {
          const [a, b] = l.s.diff!;
          const mid = rel(l.s.fair! - l.s.venueF!, l.s);
          const kind = verdict(l.s)!.kind;
          return (
            <div key={`${l.cat}${l.venue}${l.horizon}`} className={`forest-row ${kind}`}>
              <span>
                {VENUE_NAME[l.venue] ?? l.venue} {l.cat.toLowerCase()} ·{" "}
                {HORIZONS.find(([m]) => m === l.horizon)?.[1] ?? `${l.horizon} min`}
              </span>
              <span
                className="forest-track"
                title={`Fair minus venue Brier: ${signedB(a)} to ${signedB(b)} (90% range), ${mid >= 0 ? "+" : "−"}${Math.abs(mid).toFixed(1)}% of the venue's score`}
              >
                <span
                  className="forest-range"
                  style={{ left: pos(rel(a, l.s)), width: `calc(${pos(rel(b, l.s))} - ${pos(rel(a, l.s))})` }}
                />
                <span className="forest-dot" style={{ left: pos(mid) }} />
              </span>
              <span className="num">{n0(l.s.fairEvents)}</span>
            </div>
          );
        })}
      </div>
      <p className="note">
        The dot is how much higher or lower fair value&apos;s Brier score was than the venue&apos;s,
        as a share of the venue&apos;s; the bar is its 90% range from resampling whole closes. Mint:
        Manta measurably more accurate; red: measurably less; grey: no measurable difference.
        Ranges past ±{Math.round(reach)}% are cut at the edge. Crypto fair values come from
        Deribit&apos;s options; elsewhere they are a consensus of the venues&apos; own books, so
        expect little difference there.
      </p>
    </section>
  );
}
