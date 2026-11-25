// How it's built: the system in one diagram, its measured numbers (each with its date), and the
// data-quality and coverage view moved from the old /quality page (2026-11-26). The diagram is
// plain HTML and CSS so it reflows on a phone; no infra values (addresses, hostnames, accounts).
import { connection } from "next/server";
import { Suspense } from "react";
import { FAMILIES } from "@/lib/families";
import { getReport } from "@/lib/quality";
import { utc } from "@/lib/format";
import Quality, { Checks, count } from "./quality";

export const metadata = { title: "Manta: how it's built" };

const REPO = "https://github.com/carsonturnr/manta-markets";
const CONTRACT_FAMILIES = FAMILIES.filter((f) => f.category !== "Reference prices").length;

export default function BuiltPage() {
  return (
    <>
      <h1>How it&apos;s built</h1>
      <p className="lede">
        One recorder keeps every message the venues send; everything on this site is computed from
        that recording or from snapshots of the same public APIs. Nothing here places a real order.
      </p>

      <section id="diagram" className="built-section">
        <h2>From venue to screen</h2>
        <Diagram />
      </section>

      <section id="numbers" className="built-section">
        <h2>The numbers</h2>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Numbers />
        </Suspense>
      </section>

      <section id="quality" className="built-section">
        <h2>Data quality and coverage</h2>
        <p className="muted">
          Before trusting a chart or a backtest, check what the recorder captured and what it
          missed. Updated every 15 minutes.
        </p>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Quality />
        </Suspense>
        <Checks />
      </section>

      <section id="source" className="built-section">
        <h2>Source and decisions</h2>
        <ul className="built-links">
          <li>
            <a href={REPO}>The code</a>: recorder (Go), pricing (Python), backtests (Python with
            NautilusTrader) and this site (Next.js), MIT licensed.
          </li>
          <li>
            <a href={`${REPO}/blob/main/docs/decisions.md`}>The decisions log</a>: every design
            choice with the date and the measurement behind it.
          </li>
        </ul>
      </section>
    </>
  );
}

/** A box in the diagram: what it is, what it runs on, one line of what it does. */
function Node({ name, tech, children }: { name: string; tech: string; children: React.ReactNode }) {
  return (
    <div className="arch-node">
      <b>{name}</b>
      <span className="m3 small">{tech}</span>
      <p className="small">{children}</p>
    </div>
  );
}

const Arrow = ({ label }: { label?: string }) => (
  <div className="arch-arrow small m3" aria-hidden={!label}>
    <span>↓</span>
    {label}
  </div>
);

function Diagram() {
  return (
    <figure className="panel pad arch" aria-label="Architecture: venues feed a Go recorder, which feeds an archive, Python pricing jobs writing Postgres for the site, and a live relay for the terminal">
      <Node name="Venues" tech="Kalshi · Polymarket · Deribit · Coinbase · Kraken · Binance">
        Public feeds only, read-only. Kalshi and Polymarket are the markets; the rest are reference
        prices for fair values.
      </Node>
      <Arrow label="WebSocket and REST" />
      <Node name="Recorder" tech="Go · one virtual machine">
        Writes every raw message to hourly gzip files, unchanged. It records only an explicit
        allow-list and will not start unless each series is filed under crypto, economics or
        financials.
      </Node>
      <div className="arch-lanes">
        <div className="arch-lane">
          <Arrow label="raw hourly files" />
          <Node name="Archive" tech="storage box · nightly">
            Copied as-is and checked by checksum each night; the source for replays and backtests.
          </Node>
          <Arrow />
          <Node name="Replay and backtests" tech="Go · Python, NautilusTrader">
            Rebuilds every order book of a past hour from the recording.
          </Node>
        </div>
        <div className="arch-lane">
          <Arrow label="listings, books, prices" />
          <Node name="Pricing jobs" tech="Python · every 1 to 15 minutes">
            Snapshots, fair values, costs to trade, cross-venue pairs and data quality.
          </Node>
          <Arrow />
          <Node name="Postgres" tech="Supabase · read-only login for the site">
            One schema of tables; the site can read but never write it.
          </Node>
          <Arrow />
          <Node name="Site" tech="Next.js · Vercel">
            Markets, market pages, insights and this page, read at request time.
          </Node>
        </div>
        <div className="arch-lane">
          <Arrow label="Kalshi books and trades" />
          <Node name="Live relay" tech="Go · inside the recorder">
            Keeps each Kalshi book in memory and streams changes (Server-Sent Events), at most every
            250 ms per market.
          </Node>
          <Arrow />
          <Node name="Terminal" tech="Next.js · streamed">
            Live books, depth and trades, with polling as the fallback.
          </Node>
        </div>
      </div>
    </figure>
  );
}

const ms = (iso: string) => new Date(iso).getTime();

/** Live figures from the recorder's latest report, then fixed measurements, each with its date. */
async function Numbers() {
  await connection(); // request time only: the build never queries the database
  const got = await getReport();
  const venues = got?.report.venues ?? [];
  const records = venues.reduce((s, v) => s + v.records, 0);
  const lowest = venues.length ? Math.min(...venues.map((v) => v.coverage)) : null;
  const since = venues.length ? Math.min(...venues.map((v) => ms(v.first))) : null;
  const asOf = got ? utc(ms(got.report.generated)) : "–";
  const tiles: { label: string; value: string; note: string }[] = [
    {
      label: "Messages recorded",
      value: got ? count(records) : "–",
      note: `since ${since === null ? "–" : utc(since).replace(/, .*/, "")}; as of ${asOf}`,
    },
    {
      label: "Lowest venue coverage",
      value: lowest === null ? "–" : `${(lowest * 100).toFixed(2)}%`,
      note: `share of time recorded, worst of ${venues.length} venues; as of ${asOf}`,
    },
    {
      label: "Contract families",
      value: String(CONTRACT_FAMILIES),
      note: "Kalshi series and Polymarket families on the allow-list; no sports",
    },
    {
      label: "Relay latency",
      value: "93 ms",
      note: "median from the recorder receiving a change to the browser (p90 217 ms); measured Nov 23",
    },
    {
      label: "Book replay check",
      value: "0",
      note: "mismatches in 5.6 million replayed updates against 9,184 of Kalshi's own snapshots; Nov 13",
    },
    {
      label: "Automated tests",
      value: "185",
      note: "65 Go, 55 Python, 65 site; all passing, counted Nov 25",
    },
  ];
  return (
    <div className="built-numbers">
      {tiles.map((t) => (
        <div key={t.label} className="panel tile">
          <span>{t.label}</span>
          <b className="num">{t.value}</b>
          <small>{t.note}</small>
        </div>
      ))}
    </div>
  );
}
