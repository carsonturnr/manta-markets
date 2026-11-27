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
        <Steps />
        <details className="more arch-more">
          <summary>What each part does</summary>
          <Diagram />
        </details>

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
          <Node name="Postgres" tech="on the VM · read-only login for the site">
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

// The system as four small drawings, one per job, each with a one-line caption: thin grey lines,
// one mint mark for the point of each, tiny mono labels. Drawn at about the size they show, so
// labels stay readable down to a phone.
const STEPS = [
  {
    title: "Record every message",
    text: "Six venues' raw feeds, kept unchanged in hourly files.",
    tech: "Go recorder",
    art: <RecordArt />,
  },
  {
    title: "Rebuild any past minute",
    text: "Every order book of a past hour, rebuilt from the recording.",
    tech: "Go replay, NautilusTrader",
    art: <ReplayArt />,
  },
  {
    title: "Price each contract",
    text: "Fair values from options and both venues, every minute.",
    tech: "Python, Postgres",
    art: <PriceArt />,
  },
  {
    title: "Stream books live",
    text: "A Kalshi book change reaches the terminal in about 93 ms.",
    tech: "Go relay, Next.js",
    art: <StreamArt />,
  },
];

function Steps() {
  return (
    <div className="steps">
      {STEPS.map((st, i) => (
        <article key={st.title} className="panel step">
          <div className="step-art" aria-hidden="true">
            {st.art}
          </div>
          <span className="m3 num small">{String(i + 1).padStart(2, "0")}</span>
          <h3>{st.title}</h3>
          <p className="small">{st.text}</p>
          <span className="step-tech">{st.tech}</span>
        </article>
      ))}
    </div>
  );
}

// Shared drawing sizes: a 260 × 130 box for each card.
const W = 260;
const H = 130;

function RecordArt() {
  const ys = [15, 35, 55, 75, 95, 115];
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      {ys.map((y) => (
        <g key={y}>
          <circle cx="18" cy={y} r="3" className="art-dot" />
          <path d={`M21,${y} C70,${y} 70,65 112,65`} className="art-line" />
        </g>
      ))}
      <circle cx="118" cy="65" r="7" className="art-mint" />
      <path d="M125,65 L168,65" className="art-line" />
      {[0, 1, 2].map((k) => (
        <rect key={k} x={176 + k * 6} y={40 - k * 6} width="52" height="62" rx="2" className="art-box" />
      ))}
      <text x="18" y="128" className="art-t">6 venues</text>
      <text x="188" y="122" className="art-t">hourly files</text>
    </svg>
  );
}

function ReplayArt() {
  const bids = [34, 26, 40, 18, 22];
  const asks = [20, 30, 16, 38, 24];
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      {bids.map((w, i) => (
        <rect key={`b${i}`} x={128 - w} y={14 + i * 12} width={w} height="8" className="art-bar" />
      ))}
      {asks.map((w, i) => (
        <rect key={`a${i}`} x="132" y={14 + i * 12} width={w} height="8" className="art-bar" />
      ))}
      <path d="M130,10 L130,76" className="art-line" />
      <path d="M14,100 L246,100" className="art-line" />
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d={`M${14 + i * 21},96 L${14 + i * 21},104`} className="art-line" />
      ))}
      <path d="M130,82 L130,100" className="art-dash" />
      <circle cx="130" cy="100" r="5" className="art-mint" />
      <text x="14" y="122" className="art-t">14:00</text>
      <text x="112" y="122" className="art-t">14:37</text>
      <text x="218" y="122" className="art-t">15:00</text>
    </svg>
  );
}

function PriceArt() {
  // A ladder of strikes: the market's bid-ask as a short bar, fair value as a mint dot.
  const rows = [
    [0.92, 0.94, 0.95],
    [0.71, 0.74, 0.7],
    [0.45, 0.48, 0.44],
    [0.2, 0.23, 0.18],
    [0.06, 0.09, 0.03],
  ];
  const x = (p: number) => 70 + p * 170;
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      {rows.map(([b, a, f], i) => {
        const y = 16 + i * 22;
        return (
          <g key={i}>
            <text x="14" y={y + 4} className="art-t">{`$${59 + i}k`}</text>
            <path d={`M70,${y} L240,${y}`} className="art-faint" />
            <rect x={x(b) - 6} y={y - 4} width={x(a) - x(b) + 12} height="8" rx="1" className="art-bar light" />
            <circle cx={x(f)} cy={y} r="3.5" className="art-mint" />
          </g>
        );
      })}
      <text x="70" y="128" className="art-t">market bar · fair dot</text>
    </svg>
  );
}

function StreamArt() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      <rect x="14" y="44" width="56" height="40" rx="2" className="art-box" />
      <text x="24" y="68" className="art-t">relay</text>
      <path d="M70,64 L170,64" className="art-mint-line" />
      {[92, 116, 140].map((cx) => (
        <circle key={cx} cx={cx} cy="64" r="2.5" className="art-mint" />
      ))}
      <rect x="174" y="30" width="72" height="54" rx="2" className="art-box" />
      {[0, 1, 2, 3].map((k) => (
        <path key={k} d={`M182,${42 + k * 10} L${200 + ((k * 13) % 36)},${42 + k * 10}`} className="art-line" />
      ))}
      <path d="M196,84 L224,84 M210,84 L210,94" className="art-line" />
      <text x="104" y="54" className="art-t">93 ms</text>
      <text x="184" y="112" className="art-t">terminal</text>
    </svg>
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
