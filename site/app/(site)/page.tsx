// Home, for someone who trades on Kalshi or Polymarket: what Manta gives them in one sentence, the
// live terminal as the picture, then the busiest markets, an AI brief on the most-traded one, the
// price gaps between the venues that survive fees, and the tools for advanced traders. Built from
// the queries the pages already use (events, pairs, the brief); nothing new is stored.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import EventCard, { eventHref } from "@/components/EventCard";
import { Chart, MarketBrief } from "@/components/ContractSections";
import Mark from "@/components/Mark";
import { SnapshotLive } from "@/components/terminal/Live";
import { BookPanel, DepthPanel, TapePanel } from "@/components/terminal/LivePanels";
import Monitor from "@/components/terminal/Monitor";
import { ArbPanel, BoardPanel, CalendarPanel, DistPanel, FairPanel } from "@/components/terminal/Panels";
import TerminalDemo from "@/components/terminal/TerminalDemo";
import WaitlistForm from "@/components/WaitlistForm";
import { getBrief } from "@/lib/brief-api";
import { arbitrage, crossed, getPairs } from "@/lib/compare";
import { type Event, getEvents } from "@/lib/events";
import { FILTERS, pick } from "@/lib/markets";
import { monitorRows } from "@/lib/monitor";
import { mid, outcomeLabel, usableFair, whenET } from "@/lib/outcomes";
import { getMarket } from "@/lib/screener";
import { kalshiBook, kalshiTrades } from "@/lib/venues";

type Params = Record<string, string | string[] | undefined>;

export default function Home({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <section className="hero hero-split">
        <div className="hero-copy">
          <h1>Every Kalshi and Polymarket market, in one place.</h1>
          <p>
            See what&apos;s moving and why with an AI summary, spot price gaps between the two venues
            after fees, and get an email when a price hits your level. Crypto, economics and
            finance; no sports.
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

      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<section className="split-sec" />}>
        <Brief />
      </Suspense>

      <Suspense fallback={<section className="split-sec" />}>
        <Arbitrage />
      </Suspense>

      <Advanced />

      <section className="cta-box">
        <span className="tag">Coming next</span>
        <h2>Manta&apos;s numbers in your own code</h2>
        <p className="muted">An API is on the way. One email when it opens.</p>
        <WaitlistForm />
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
            <span className="t-venue kalshi">Kalshi</span>
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

/** The AI brief on the most-traded market: what moved and how busy it is, in plain bullets. The
 * section is hidden when the brief is (no key, or the call failed). */
async function Brief() {
  await connection();
  const { events } = await getEvents();
  const top = topKalshi(events);
  if (!top || !(await getBrief(top.o.venue, top.o.id))) return null; // cached: MarketBrief reuses it
  const { o, e } = top;
  return (
    <section className="split-sec">
      <div>
        <span className="tag">What&apos;s moving</span>
        <h2>The most-traded market, explained</h2>
        <p className="muted">
          {e.question} <b>{outcomeLabel(o)}</b>
        </p>
        <Link href={eventHref(e)} className="text-link">
          Open this market →
        </Link>
      </div>
      <MarketBrief c={o} />
    </section>
  );
}

/** Price gaps between the venues that are still there after both venues' fees, in plain words. */
async function Arbitrage() {
  await connection();
  const { pairs } = await getPairs();
  const arbs = arbitrage(pairs).slice(0, 4);
  const before = pairs.filter((p) => crossed(p) !== null).length;
  const c = (v: number | null) => (v === null ? "–" : `${Math.round(v * 1000) / 10}¢`);
  return (
    <section className="split-sec">
      <div>
        <span className="tag">Arbitrage</span>
        <h2>Same question, two prices</h2>
        <p className="muted">
          When Kalshi and Polymarket price the same question differently, you can buy on one, sell
          on the other and keep the difference. These gaps are still there after both venues&apos;
          fees.
        </p>
        <Link href="/compare" className="text-link">
          All {pairs.length} matched questions →
        </Link>
      </div>
      {arbs.length === 0 ? (
        <p className="muted">
          None right now: {before === 0 ? "the prices agree." : `${before} differ, but fees would eat the profit.`}{" "}
          Checked every minute.
        </p>
      ) : (
        <ul className="watching arb-home">
          {arbs.map(({ p, x, buy, sell, size }) => (
            <li key={`${p.topic}/${p.question}`}>
              <Link href="/compare" className="row-link">
                <span className="mono">{p.topic}</span>
                <b className="num up">{x.net.toFixed(1)}¢</b>
                <span>
                  <span className="arb-home-q">{p.question}</span>
                  Buy yes on {x.buy} at {c(buy.ask)}, sell yes on {x.sell} at {c(sell.bid)}:{" "}
                  {x.net.toFixed(1)}¢ left per contract after fees
                  {size !== null && <>, on up to {size.toLocaleString("en-US")} contracts</>}.
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The detailed tools, one level deeper, for traders who want the raw view. */
function Advanced() {
  const tools = [
    ["/terminal", "Terminal", "Live order book, trades, depth and the price chart on one screen."],
    ["/screener", "Screener table", "Every contract in one sortable table: price, spread, volume, closing time."],
    ["/distributions", "Distributions", "What a range of price levels says the market expects, as one chart."],
    ["/liquidity", "Liquidity", "What a trade really costs, and when spreads are narrowest."],
    ["/replay", "Replay", "Any recorded close, minute by minute: the book, the trades, the price."],
  ];
  return (
    <section className="band tools-band">
      <span className="tag">For advanced traders</span>
      <h2>The detailed tools</h2>
      <p className="band-sub">Always one click away, under Tools in the menu.</p>
      <ol className="ranked">
        {tools.map(([href, name, text]) => (
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

async function Markets({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const p = await searchParams;
  const raw = Array.isArray(p.cat) ? p.cat[0] : p.cat;
  const f = FILTERS.find((c) => c === raw) ?? "All";
  const { events, at } = await getEvents();
  const now = at ?? 0;
  // 15-minute contracts expire before a reader gets to them; they stay on the Markets page.
  const shown = pick(events, f, now)
    .filter((e) => !e.family.endsWith("15M"))
    .slice(0, 9);
  return (
    <section className="markets-home">
      <span className="tag">Markets</span>
      <div className="section-h">
        <h2>Busiest markets today</h2>
        <nav className="chip-row" aria-label="Filter markets">
          {FILTERS.map((c) => (
            <Link
              key={c}
              href={c === "All" ? "/" : `/?cat=${encodeURIComponent(c)}`}
              className={c === f ? "chip-link on" : "chip-link"}
              scroll={false}
            >
              {c}
            </Link>
          ))}
        </nav>
        <Link href={f === "All" ? "/markets" : `/markets?cat=${encodeURIComponent(f)}`} className="right text-link">
          All markets →
        </Link>
      </div>
      <p className="muted small">
        Prices read as chances: a contract at 37¢ pays $1 if it happens, so traders put it at about
        37%.
      </p>
      {shown.length === 0 ? (
        <p className="muted">Nothing here right now.</p>
      ) : (
        <div className="event-grid">
          {shown.map((e) => (
            <EventCard key={`${e.venue}/${e.event}`} e={e} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
