// Home: one line on what Manta is, the live terminal as the picture, the system's numbers, and
// a link to each page. Built from the queries the pages already use (events, the recorder's
// quality report); nothing new is stored.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chart } from "@/components/ContractSections";
import Mark from "@/components/Mark";
import { SnapshotLive } from "@/components/terminal/Live";
import { BookPanel, DepthPanel, TapePanel } from "@/components/terminal/LivePanels";
import Monitor from "@/components/terminal/Monitor";
import { ArbPanel, BoardPanel, CalendarPanel, DistPanel, FairPanel } from "@/components/terminal/Panels";
import TerminalDemo from "@/components/terminal/TerminalDemo";
import VenueLogo from "@/components/VenueLogo";
import { type Event, getEvents } from "@/lib/events";
import { monitorRows } from "@/lib/monitor";
import { mid, outcomeLabel, usableFair, whenET } from "@/lib/outcomes";
import { getReport } from "@/lib/quality";
import { getMarket } from "@/lib/screener";
import { kalshiBook, kalshiTrades } from "@/lib/venues";

export default function Home() {
  return (
    <>
      <section className="hero hero-split">
        <div className="hero-copy">
          <h1>A terminal for prediction markets.</h1>
          <p>
            Live order books, prices and costs for every crypto, economics and financial contract on
            Kalshi and Polymarket, from Manta&apos;s own recordings of both venues. No sports.
          </p>
          <div className="hero-btns">
            <Link href="/markets" className="btn">
              Browse markets
            </Link>
            <Link href="/terminal" className="btn btn-ghost">
              Open the terminal
            </Link>
          </div>
        </div>
        <Suspense fallback={<div className="panel preview" />}>
          <Preview />
        </Suspense>
      </section>

      <Suspense fallback={<section className="stats-row home-figures" />}>
        <Figures />
      </Suspense>

      <Pages />

      <section className="cta-box">
        <span className="tag">API</span>
        <h2>Manta&apos;s numbers in your own code</h2>
        <p className="muted">
          Fair values, implied distributions, the cost of a trade, cross-venue gaps and liquidity, as
          JSON. Free with an account.
        </p>
        <div className="cta-actions">
          <Link href="/account" className="btn">
            Get an API key
          </Link>
          <Link href="/docs/api" className="btn btn-ghost">
            Read the docs
          </Link>
        </div>
      </section>
    </>
  );
}

/** Kalshi's most-traded contract in dollars (contracts × midpoint) and its event: by contract
 * count alone, 2¢ long shots win. Kalshi only, as the demo's chart and book read Kalshi's API. */
function topKalshi(events: Event[]) {
  const kalshi = events.filter((x) => x.venue === "kalshi");
  const dollars = (r: Event["outcomes"][number]) => r.volume * (mid(r) ?? 0);
  const o = kalshi.flatMap((x) => x.outcomes).sort((a, b) => dollars(b) - dollars(a))[0];
  const e = o && kalshi.find((x) => x.outcomes.includes(o));
  return o && e ? { o, e, dollars: dollars(o) } : null;
}

/** The hero's picture of the product: the terminal itself, on Kalshi's most-traded contract (in dollars) in
 * the last 24 hours. The same panels as /terminal (markets, price chart, book, depth, trades) fed one
 * server-side reading of the book and trades, so the home page streams nothing. */
async function Preview() {
  await connection(); // request time only: the build never queries the database
  const { events, at } = await getEvents();
  const now = at ?? 0;
  const top = topKalshi(events);
  if (!top) return <div className="panel preview" />;
  const { o, e } = top;
  const [book, trades, market] = await Promise.all([kalshiBook(o.id), kalshiTrades(o.id), getMarket(o.venue, o.id)]);
  const focus = `${o.venue}:${o.id}`;
  const fair = usableFair(o);
  // Each panel once, tagged with the terminal layouts it appears in (app/terminal/page.tsx LAYOUTS).
  const panel = (key: string, code: string, title: string, layouts: string, body: React.ReactNode) => (
    <section className="t-panel" style={{ gridArea: key }} data-panel={key} data-layouts={layouts}>
      <header>
        <span className="t-code">{code}</span>
        <h2>{title}</h2>
      </header>
      <div className="t-body">{body}</div>
    </section>
  );
  const wait = <p className="t-empty">Loading…</p>;
  return (
    <SnapshotLive book={book} trades={trades} at={now}>
      <TerminalDemo
        contract={focus}
        brand={
          <Link href={`/terminal?m=${encodeURIComponent(focus)}`} className="t-brand">
            <Mark /> Manta <span className="t-dim">Terminal</span>
          </Link>
        }
        focus={
          <div className="t-focus num">
            <VenueLogo venue="kalshi" />
            <b className="t-focus-q">{e.question}</b>
            <span className="t-focus-o">{outcomeLabel(o)}</span>
            <span>
              <span className="t-dim">Mid</span> <b>{pct1(mid(o))}</b>
            </span>
            <span>
              <span className="t-dim">Fair</span> <b className="t-mint">{pct1(fair)}</b>
            </span>
            <span>
              <span className="t-dim">Traded 24 h</span> ${Math.round(top.dollars).toLocaleString("en-US")}
            </span>
            <span>
              <span className="t-dim">Closes</span> {whenET(e.close, now)}
            </span>
          </div>
        }
      >
        {panel("mon", "MON", "Markets", "market monitor", <Monitor rows={monitorRows(events)} focus={focus} layout="market" now={now} />)}
        {panel("chart", "GP", "Price", "market monitor arb catalysts", <Chart c={o} tracked={market?.tracked ?? false} />)}
        {panel("book", "BOOK", "Order book", "market arb", <BookPanel fair={fair} />)}
        {panel("depth", "DPTH", "Depth and liquidity", "market arb", <DepthPanel />)}
        {panel("tape", "TAPE", "Trades", "market arb", <TapePanel />)}
        {panel(
          "arb",
          "ARB",
          "Cross-venue arbitrage",
          "monitor arb",
          <Suspense fallback={wait}>
            <ArbPanel events={events} layout="arb" />
          </Suspense>,
        )}
        {panel("cal", "CAL", "Catalysts", "monitor catalysts", <CalendarPanel events={events} now={now} layout="catalysts" />)}
        {panel(
          "dist",
          "DIST",
          "Implied distribution",
          "catalysts",
          <Suspense fallback={wait}>
            <DistPanel event={e.event} />
          </Suspense>,
        )}
        {panel("board", "EVT", "Every outcome", "catalysts", <BoardPanel e={e} focus={o.id} layout="catalysts" />)}
        {panel(
          "fair",
          "FV",
          "Fair value",
          "catalysts",
          <Suspense fallback={wait}>
            <FairPanel o={o} close={e.close} now={now} />
          </Suspense>,
        )}
      </TerminalDemo>
    </SnapshotLive>
  );
}

/** A probability as a percent with one decimal, as the terminal shows it. */
const pct1 = (p: number | null) => (p === null ? "–" : `${(Math.round(p * 1000) / 10).toFixed(1)}%`);

/** The system in five numbers: what the site covers now and what the recorder has kept. */
async function Figures() {
  await connection(); // request time only: the build never queries the database
  const [{ events }, q] = await Promise.all([getEvents(), getReport()]);
  const contracts = events.reduce((n, e) => n + e.outcomes.length, 0);
  const venues = q?.report.venues ?? [];
  const records = venues.reduce((n, v) => n + v.records, 0);
  const since = venues.length ? Math.min(...venues.map((v) => Date.parse(v.first))) : null;
  const lowest = venues.length ? Math.min(...venues.map((v) => v.coverage)) : null;
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const figs: [string, string, string][] = [
    [
      contracts.toLocaleString("en-US"),
      "contracts quoted now",
      "Open contracts with both a bid and an ask, on Kalshi and Polymarket together.",
    ],
    [
      String(venues.length || "–"),
      "venues recorded",
      "Every feed the recorder keeps: the two prediction markets, plus options and spot prices used for fair values.",
    ],
    [
      records ? `${(records / 1e9).toFixed(2)}B` : "–",
      since === null ? "messages recorded" : `messages recorded since ${day(since)}`,
      "Raw messages from the venues, saved as they arrived and archived every hour.",
    ],
    [
      lowest === null ? "–" : `${(lowest * 100).toFixed(2)}%`,
      "of the time captured",
      "The share of time the recorder was receiving data, on the venue with the most gaps.",
    ],
    [
      "93 ms",
      "live book delay",
      "Median time from the recorder receiving a Kalshi book change to a browser showing it (measured Nov 23).",
    ],
  ];
  return (
    <section className="stats-row home-figures" aria-label="Manta in numbers">
      <div className="figures-row">
        {figs.map(([n, label, help]) => (
          <div key={label}>
            <b className="num">{n}</b>
            <span>{label}</span>
            <small>{help}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Where to go next: one line per page. */
function Pages() {
  const pages = [
    ["/markets", "Markets", "Every open contract in one sortable table: price, spread, size, volume, gap to fair value."],
    ["/insights", "Insights", "What the recordings say: when spreads are tightest, how accurate prices are, what crossing venues costs."],
    ["/how-its-built", "How it's built", "From the venues' feeds to this page: the recorder, the archive, the pricing and the site."],
    ["/terminal", "Terminal", "Chart, order book, depth and trades for one contract, live, on one screen."],
  ];
  return (
    <section className="home-pages">
      <span className="tag">Explore</span>
      <ol className="ranked">
        {pages.map(([href, name, text]) => (
          <li key={href}>
            <Link href={href} className="row-link">
              <span className="ranked-q">
                <b>{name}</b>
                <span>{text}</span>
              </span>
              <span className="gap-pts">Open →</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
