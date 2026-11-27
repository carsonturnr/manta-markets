// How it's built: the data-quality and coverage view, moved from the old /quality page
// (2026-11-26). Updated every 15 minutes from the recorder's own report.
import { connection } from "next/server";
import { utc } from "@/lib/format";
import {
  type Category,
  FAMILIES,
  getReport,
  type Report,
  type VenueReport,
  VENUES,
} from "@/lib/quality";

const ms = (iso: string) => new Date(iso).getTime();

/** "4 min", "1 h 12 min", "38 s". */
function duration(msec: number): string {
  const s = Math.round(msec / 1000);
  if (s < 1) return "<1 s";
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** 599450768 → "599.5M". */
export function count(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

// A venue is "recording" if its last message is this recent when the report is written.
// Every venue sends something every few seconds, Polymarket every 10 s.
const LIVE_MS = 2 * 60_000;
// The report is written every 15 minutes; older than this, something is wrong with the job.
const STALE_MS = 40 * 60_000;

export default async function Quality() {
  await connection(); // request time only: the build never queries the database
  const got = await getReport();
  if (!got) return <p className="muted">No report yet.</p>;
  const { report } = got;
  const at = ms(report.generated);
  const age = got.ageS * 1000;
  const venues = [...report.venues].sort(
    (a, b) => Object.keys(VENUES).indexOf(a.venue) - Object.keys(VENUES).indexOf(b.venue),
  );
  const behind = venues.filter((v) => at - ms(v.last) > LIVE_MS);
  return (
    <>
      {age > STALE_MS ? (
        <p className="warn">
          This report is {duration(age)} old: the job that writes it has stopped, so the
          recorder&apos;s current state is unknown.
        </p>
      ) : behind.length > 0 ? (
        <p className="warn">
          No recent data from {behind.map((v) => VENUES[v.venue]?.name ?? v.venue).join(", ")}.
        </p>
      ) : (
        <p>
          <span className="status-ok">All {venues.length} venues recording</span>{" "}
          <span className="small">as of {utc(at)}</span>
        </p>
      )}
      <Summary venues={venues} />
      <Missed venues={venues} at={at} />
      <Timeline venues={venues} at={at} />
      <details className="more">
        <summary>More: every venue, every contract family and the latest gaps</summary>
        <Venues venues={venues} at={at} />
        <Families report={report} />
        <RecentGaps venues={venues} gapS={report.gap_seconds} />
      </details>
    </>
  );
}

/** The whole report in one sentence. */
function Summary({ venues }: { venues: VenueReport[] }) {
  const since = Math.min(...venues.map((v) => ms(v.first)));
  const gaps = venues
    .flatMap((v) => v.gaps.map((g) => ({ venue: v.venue, from: ms(g.from), len: ms(g.to) - ms(g.from) })))
    .sort((a, b) => a.len - b.len);
  const lowest = Math.min(...venues.map((v) => v.coverage));
  const records = venues.reduce((s, v) => s + v.records, 0);
  const longest = gaps.at(-1);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)].len : 0;
  return (
    <p className="lead-says">
      Since {utc(since).replace(/, .*/, "")} the recorder has kept{" "}
      <b className="num">{count(records)}</b> messages from {venues.length} venues and captured at
      least <b className="num">{pct(lowest)}</b> of the time on every one.
      {longest ? (
        <>
          {" "}
          Its {gaps.length} gaps were mostly brief (half under {duration(median)}); the longest was{" "}
          <b className="num">{duration(longest.len)}</b> on{" "}
          {VENUES[longest.venue]?.name ?? longest.venue}, {utc(longest.from).replace(/, .*/, "")}.
        </>
      ) : (
        " No gaps."
      )}
    </p>
  );
}

/** Each venue's coverage, with the time it missed as a bar (scaled to the venue that missed most). */
function Missed({ venues, at }: { venues: VenueReport[]; at: number }) {
  const rows = venues.map((v) => ({
    v,
    lost: v.gaps.reduce((s, g) => s + ms(g.to) - ms(g.from), 0),
    late: at - ms(v.last) > LIVE_MS,
  }));
  const most = Math.max(1, ...rows.map((r) => r.lost));
  return (
    <section className="panel stack">
      <header className="ph">
        <h3>Captured, by venue</h3>
        <span className="right m3">since each venue was added</span>
      </header>
      <div className="pad q-bars">
        {rows.map(({ v, lost, late }) => (
          <div key={v.venue} className="q-row">
            <span>{VENUES[v.venue]?.name ?? v.venue}</span>
            <b className="num">{pct(v.coverage)}</b>
            <span className="q-track" title={`${duration(lost)} missed in ${v.gaps.length} gaps`}>
              <span className="q-bar" style={{ width: `${(lost / most) * 100}%` }} />
            </span>
            <span className="num m3">
              {duration(lost)} missed · {v.gaps.length} {v.gaps.length === 1 ? "gap" : "gaps"}
            </span>
            <span className={late ? "num status-bad" : "num m3"}>
              {late ? "no recent data" : "recording"}
            </span>
          </div>
        ))}
      </div>
      <p className="note">
        Bars: time missed, scaled to the venue that missed most. A gap is a disconnect or restart
        of the recorder (those are the ones of a few seconds), or any stretch of more than 30
        seconds with no data from a venue.
      </p>
    </section>
  );
}

/** Messages per second over the last 24 hours of the hourly counts. */
function rate(v: VenueReport, at: number): number {
  const from = at - 24 * 3600_000;
  let n = 0;
  for (const [hour, c] of Object.entries(v.hours)) {
    if (ms(`${hour}:00:00Z`) >= from) n += c;
  }
  return n / (24 * 3600);
}

function Venues({ venues, at }: { venues: VenueReport[]; at: number }) {
  return (
    <>
      <h3>Venues</h3>
      <p className="small">
        Coverage is the share of time since the venue was added that isn&apos;t in a gap.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th style={{ textAlign: "left" }}>What we record</th>
              <th>Since</th>
              <th>Msgs/s, 24 h</th>
              <th>Gaps</th>
              <th>Coverage</th>
              <th>Last message</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((v) => {
              const lag = at - ms(v.last);
              return (
                <tr key={v.venue}>
                  <td>{VENUES[v.venue]?.name ?? v.venue}</td>
                  <td className="small" style={{ textAlign: "left", whiteSpace: "normal" }}>
                    {VENUES[v.venue]?.what}
                  </td>
                  <td className="num">{utc(ms(v.first)).replace(/, .*/, "")}</td>
                  <td className="num">
                    {rate(v, at).toLocaleString("en-US", {
                      maximumFractionDigits: rate(v, at) < 10 ? 1 : 0,
                    })}
                  </td>
                  <td className="num">{v.gaps.length}</td>
                  <td className="num">{pct(v.coverage)}</td>
                  <td className={lag > LIVE_MS ? "num status-bad" : "num"}>
                    {lag < 1000 ? "<1 s" : duration(lag)} before
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const BLOCK_MS = 3 * 3600_000;
const BLOCKS = 56; // 7 days of 3-hour blocks

type Cell = { start: number; state: "none" | "ok" | "blip" | "gap"; lost: number };
const BLIP_MS = 60_000; // a block missing under a minute in all: a blip, drawn apart from real gaps

/** Each venue's last 7 days in 3-hour blocks: not recorded, recorded, or containing a gap. */
function cells(v: VenueReport, at: number): Cell[] {
  const end = Math.floor(at / BLOCK_MS) * BLOCK_MS + BLOCK_MS;
  const first = ms(v.first);
  const last = ms(v.last);
  return Array.from({ length: BLOCKS }, (_, i) => {
    const start = end - (BLOCKS - i) * BLOCK_MS;
    const stop = start + BLOCK_MS;
    if (stop <= first || start > last) return { start, state: "none", lost: 0 };
    let lost = 0;
    for (const g of v.gaps) {
      lost += Math.max(0, Math.min(stop, ms(g.to)) - Math.max(start, ms(g.from)));
    }
    return { start, state: lost >= BLIP_MS ? "gap" : lost > 0 ? "blip" : "ok", lost };
  });
}

function Timeline({ venues, at }: { venues: VenueReport[]; at: number }) {
  const rows = venues.map((v) => ({ v, cells: cells(v, at) }));
  const days = rows[0].cells.filter((c) => new Date(c.start).getUTCHours() === 0);
  return (
    <>
      <h3>Last 7 days, where the gaps fell</h3>
      <div className="legend">
        <span>
          <span className="key cell-ok" />
          recorded
        </span>
        <span>
          <span className="key cell-blip" />
          under a minute missing
        </span>
        <span>
          <span className="key cell-gap" />a minute or more missing (hover for its length)
        </span>
        <span>
          <span className="key" style={{ background: "var(--grid)" }} />
          not recorded yet
        </span>
      </div>
      <div className="table-wrap">
        <div className="timeline">
          {rows.map(({ v, cells }) => (
            <div className="timeline-row" key={v.venue}>
              <span className="small">{VENUES[v.venue]?.name ?? v.venue}</span>
              <div className="timeline-cells">
                {cells.map((c) => (
                  <div
                    key={c.start}
                    className={`cell cell-${c.state}`}
                    title={`${utc(c.start)}, 3 h: ${
                      c.state === "none"
                        ? "not recorded"
                        : c.state !== "ok"
                          ? `${duration(c.lost)} missing`
                          : "complete"
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="timeline-row small">
            <span />
            <div className="timeline-cells">
              {rows[0].cells.map((c) => (
                <span key={c.start}>
                  {days.includes(c) ? utc(c.start).replace(/, .*/, "") : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p className="small">3-hour blocks, UTC. Blocks before a venue was added are grey.</p>
    </>
  );
}

const CATEGORIES: Category[] = ["Crypto", "Economics", "Financials", "Reference prices"];

function Families({ report }: { report: Report }) {
  const got = new Map(report.families.map((f) => [`${f.venue}/${f.family}`, f]));
  const known = new Set(FAMILIES.map((f) => `${f.venue}/${f.family}`));
  const extra = report.families.filter((f) => !known.has(`${f.venue}/${f.family}`));
  return (
    <>
      <h3>Contract families</h3>
      <p className="small">
        Every family is on an explicit allow-list: Kalshi series are checked against Kalshi&apos;s
        category when the recorder starts, Polymarket events must match a strict pattern and tags.
        No sports markets are ever recorded. Families share their venue&apos;s connection, so their
        coverage is the venue&apos;s.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th style={{ textAlign: "left" }}>Venue</th>
              <th>Contracts with data, 2 h</th>
              <th>Messages, 24 h</th>
            </tr>
          </thead>
          {CATEGORIES.map((cat) => (
            <tbody key={cat}>
              <tr>
                <th colSpan={4} style={{ textAlign: "left", paddingTop: 16 }}>
                  {cat}
                </th>
              </tr>
              {FAMILIES.filter((f) => f.category === cat).map((f) => {
                const r = got.get(`${f.venue}/${f.family}`);
                return (
                  <tr key={`${f.venue}/${f.family}`}>
                    <td>{f.name}</td>
                    <td style={{ textAlign: "left" }}>
                      {VENUES[f.venue]?.name}
                      {f.venue === "kalshi" && <span className="small"> {f.family}</span>}
                    </td>
                    <td className="num">
                      {r?.contracts ? r.contracts.toLocaleString("en-US") : "–"}
                    </td>
                    <td className={r || f.note ? "num" : "num status-bad"}>
                      {r ? count(r.records_24h) : (f.note ?? "no data")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {extra.length > 0 && (
        <p className="warn">
          Also in the report, not in this list:{" "}
          {extra.map((f) => `${f.venue} ${f.family || "(no family)"}`).join(", ")}.
        </p>
      )}
      <p className="small">
        A contract counts if any message about it arrived in the last two hours. Reference prices
        are recorded for fair values; Deribit&apos;s count is option contracts.
      </p>
    </>
  );
}

function RecentGaps({ venues, gapS }: { venues: VenueReport[]; gapS: number }) {
  const gaps = venues
    .flatMap((v) => v.gaps.map((g) => ({ venue: v.venue, from: ms(g.from), to: ms(g.to) })))
    .sort((a, b) => b.from - a.from)
    .slice(0, 12);
  if (gaps.length === 0) return null;
  return (
    <>
      <h3>Most recent gaps</h3>
      <p className="small">
        From the last message before the gap to the first after it (anything over {gapS} s). Gaps at
        the same moment on every venue are restarts of the recorder, usually a deploy.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>From</th>
              <th>To</th>
              <th>Length</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g) => (
              <tr key={`${g.venue}/${g.from}`}>
                <td>{VENUES[g.venue]?.name ?? g.venue}</td>
                <td className="num">{utc(g.from)}</td>
                <td className="num">{utc(g.to, false)}</td>
                <td className="num">{duration(g.to - g.from)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Checks run on the recordings, from the project's own notes (docs/milestone-4-backtest.md).
// Static: each was a one-off measurement, dated, not a live figure.
export function Checks() {
  return (
    <>
      <h3>How we check the data</h3>
      <ul className="checks">
        <li>
          <b>Order books rebuilt from the recording match Kalshi&apos;s.</b>{" "}
          <span className="muted">
            Over 2 hours (Nov 13): 5.6 million book updates replayed with 0 mismatches against 9,184
            of Kalshi&apos;s own order-book snapshots, recorded alongside.
          </span>
        </li>
        <li>
          <b>Lost updates can&apos;t go unnoticed.</b>{" "}
          <span className="muted">
            Kalshi numbers every update; the replay checks the numbering and marks a market
            unverified until its next snapshot. 99.93% of market-time verified (same 2 hours).
          </span>
        </li>
        <li>
          <b>Replayed fair values match the live ones.</b>{" "}
          <span className="muted">
            Fair values recomputed from the recording differ from the live tracker&apos;s by 0.05¢
            at the median over 2,195 values, with no bias.
          </span>
        </li>
        <li>
          <b>Not checked yet:</b>{" "}
          <span className="muted">
            the same replay checks for the families added on Nov 16 (Ether, economics, financials)
            and for Polymarket.
          </span>
        </li>
        <li>
          <b>Known limit:</b>{" "}
          <span className="muted">
            Kalshi settles Bitcoin contracts on CF Benchmarks&apos; BRTI index, which is paid data;
            we record Coinbase, Kraken and Deribit&apos;s index instead.
          </span>
        </li>
      </ul>
    </>
  );
}
