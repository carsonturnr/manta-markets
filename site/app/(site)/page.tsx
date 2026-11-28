// Home: one line on what Manta is, the live terminal as the picture, the system's numbers, a link
// to each page, six tools each drawn from live data, four findings from Insights, and the API.
// Built from the queries the pages already use (events, pairs, distributions, news, the
// recorder's quality report); nothing new is stored.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Chart } from "@/components/ContractSections";
import DistChart from "@/components/DistChart";
import Mark from "@/components/Mark";
import MoveChart from "@/components/MoveChart";
import { SnapshotLive } from "@/components/terminal/Live";
import { BookPanel, DepthPanel, TapePanel } from "@/components/terminal/LivePanels";
import Monitor from "@/components/terminal/Monitor";
import { ArbPanel, BoardPanel, CalendarPanel, DistPanel, FairPanel } from "@/components/terminal/Panels";
import TerminalDemo from "@/components/terminal/TerminalDemo";
import VenueLogo from "@/components/VenueLogo";
import { arbitrage, crossed, getPairs } from "@/lib/compare";
import { kalshiFee, walk } from "@/lib/cost";
import { fmtValue, getDistributions } from "@/lib/distributions";
import { type Event, getEvents } from "@/lib/events";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getLiquidity } from "@/lib/liquidity";
import { monitorRows } from "@/lib/monitor";
import { joined, overall, signed, sourceName } from "@/lib/news";
import { getNews, getNewsMove } from "@/lib/news-data";
import { mid, outcomeLabel, usableFair, whenET } from "@/lib/outcomes";
import { getReport } from "@/lib/quality";
import { getMarket } from "@/lib/screener";
import { calibrationAll } from "@/lib/stats";
import { worstBand } from "@/lib/stats-view";
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

      <Suspense fallback={<section className="home-tools" />}>
        <Tools />
      </Suspense>

      <Suspense fallback={<section className="home-found" />}>
        <Findings />
      </Suspense>

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

const c1 = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
const qty = (n: number) => (n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : Math.round(n).toLocaleString("en-US"));
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One tool as a terminal panel: its code and name, a picture from live data, and a link that
 * covers the whole tile (so the tile holds no other link). */
function Tool({ code, title, href, children }: { code: string; title: string; href: string; children: React.ReactNode }) {
  return (
    <section className="t-panel tool">
      <header>
        <span className="t-code">{code}</span>
        <h2>{title}</h2>
        <Link href={href} className="tool-open">
          Open →
        </Link>
      </header>
      <div className="tool-body num">{children}</div>
    </section>
  );
}

/** Six tools, each shown by what it says right now. Nearly everything here is already read for
 * the terminal preview above (events, pairs, distributions, news, and Kalshi's book unless the
 * preview's contract is about to close), so the cached results are reused; the news item's chart
 * is one more small file from the VM. */
async function Tools() {
  await connection(); // request time only: the build never queries the database
  const { events, at } = await getEvents();
  const now = at ?? 0;
  const later = events.filter((x) => x.close - now > 3_600_000);
  // The book and cost tiles: Kalshi's most-traded contract closing more than an hour out. In its
  // last minutes a contract's book empties (a 15-minute Bitcoin market led at 10:45 on 2026-11-28).
  const top = topKalshi(later);
  const [read, { pairs }, dists, news] = await Promise.all([
    top ? kalshiBook(top.o.id) : null,
    getPairs(),
    getDistributions(),
    // If the replay server is down, only the news tile is lost.
    getNews().catch((e) => {
      console.error(e);
      return null;
    }),
  ]);
  const book = read?.bids.length && read.asks.length ? read : null; // both tiles need both sides
  const rows = monitorRows(events).slice(0, 7);
  const fee = (n: number, price: number) => (top?.o.feeTaker == null ? 0 : kalshiFee(top.o.feeTaker, n, price));
  const max = book ? Math.max(1, ...book.asks.slice(0, 3).map((l) => l.size), ...book.bids.slice(0, 3).map((l) => l.size)) : 1;
  const level = (l: { price: number; size: number }, side: "ask" | "bid") => (
    <tr key={side + l.price} className={side}>
      <td>{c1(l.price)}</td>
      <td className="lvl" style={{ "--w": `${(l.size / max) * 100}%` } as React.CSSProperties}>
        {qty(l.size)}
      </td>
    </tr>
  );
  const ranked = pairs
    .map((p) => ({ p, x: crossed(p) }))
    .sort((a, b) => (b.x?.cents ?? -99) - (a.x?.cents ?? -99))
    .slice(0, 7);
  // The busiest ladder with a distribution that closes more than an hour out: nearer the close
  // the curve is a single step.
  const dist = (x: Event) => dists.find((d) => d.event === x.event && (d.venue === x.venue || d.venue === "both"));
  const dEvent = later.find(dist);
  const d = dEvent && dist(dEvent);
  // The newest item whose book move has been measured, with its biggest mover's chart; before any
  // is measured (an hour or two after it lands), the newest item alone.
  const items = news ? joined(news) : [];
  const measured = items.find(({ move }) => move && !move.release && move.contracts > 0);
  const item = measured ?? items[0];
  const detail = measured ? await getNewsMove(measured.it.key).catch(() => null) : null;
  const mover = detail?.contracts.find((c) => c.ticker === measured?.move?.top && c.mids?.length);
  const name = top ? `${top.e.question} · ${outcomeLabel(top.o)}` : "";
  return (
    <section className="home-tools">
      <div className="home-head">
        <span className="tag">Tools</span>
        <span>
          <Link href="/replay">Replay</Link>
          <Link href="/account">Alerts</Link>
          <Link href="/docs/api">API</Link>
        </span>
      </div>
      <div className="tools-grid">
        <Tool code="MKTS" title="Markets" href="/markets">
          <table>
            <thead>
              <tr>
                <th>Busiest now</th>
                <th>Mid</th>
                <th>Spread</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <div className="tool-q">
                      <VenueLogo venue={r.venue} compact />
                      <span>{r.question}</span>
                      <span className="t-dim">{r.label}</span>
                    </div>
                  </td>
                  <td>{pct1(r.mid)}</td>
                  <td>{c1(r.spread)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tool>
        {top && book && (
          <Tool code="BOOK" title="Order book" href={`/terminal?m=${encodeURIComponent(`kalshi:${top.o.id}`)}`}>
            <p>{name}</p>
            <table className="t-book">
              <tbody>
                {book.asks.slice(0, 3).map((l) => level(l, "ask")).reverse()}
                <tr className="t-spread">
                  <td colSpan={2}>
                    spread {c1(book.asks[0].price - book.bids[0].price)}
                  </td>
                </tr>
                {book.bids.slice(0, 3).map((l) => level(l, "bid"))}
              </tbody>
            </table>
          </Tool>
        )}
        {top && book && (
          <Tool code="COST" title="Cost to trade" href={`/m/kalshi/${encodeURIComponent(top.e.event)}?o=${encodeURIComponent(top.o.id)}`}>
            <p>{name}</p>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Average</th>
                  <th>Fee</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(["buy", "sell"] as const).flatMap((side) =>
                  [100, 1000, 10000].map((n) => {
                    const k = walk(side, n, side === "buy" ? book.asks : book.bids, fee);
                    return (
                      <tr key={side + n}>
                        <td>
                          {side === "buy" ? "Buy" : "Sell"} {n.toLocaleString("en-US")}
                        </td>
                        {k && k.filled === n ? (
                          <>
                            <td>{(k.average * 100).toFixed(2)}¢</td>
                            <td>{usd(k.fee)}</td>
                            <td>{usd(k.total)}</td>
                          </>
                        ) : (
                          <td colSpan={3} className="t-dim">
                            only {qty(k?.filled ?? 0)} on the book
                          </td>
                        )}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </Tool>
        )}
        <Tool code="ARB" title="Cross-venue" href="/insights#crossing">
          <table>
            <thead>
              <tr>
                <th>Same question, both venues</th>
                <th>Kalshi</th>
                <th>Polymarket</th>
                <th>After fees</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ p, x }) => (
                <tr key={`${p.topic}/${p.question}`}>
                  <td>{p.question}</td>
                  <td>
                    {c1(p.kalshi.bid)}/{c1(p.kalshi.ask)}
                  </td>
                  <td>
                    {c1(p.poly.bid)}/{c1(p.poly.ask)}
                  </td>
                  <td className={x?.net && x.net > 0 ? "up" : "t-dim"}>
                    {!x ? "no cross" : x.net === null ? "–" : `${x.net > 0 ? "+" : "−"}${Math.abs(x.net).toFixed(2)}¢`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tool>
        {d && (
          <Tool code="DIST" title="Implied distribution" href={`/m/${dEvent.venue}/${encodeURIComponent(dEvent.event)}`}>
            <p>
              {dEvent.question} Median {fmtValue(d.family, d.median)}, even odds {fmtValue(d.family, d.q25)} – {fmtValue(d.family, d.q75)}
            </p>
            <DistChart d={d} width={480} legend={false} />
          </Tool>
        )}
        {item && (
          <Tool code="NEWS" title="Official news" href={`/insights/news/${item.it.key}`}>
            <p>
              {sourceName(item.it.source)}, {utc(item.t)}: {item.it.title}
            </p>
            {measured?.move && (
              <p className="t-dim">
                {measured.move.moved} of {measured.move.contracts} Kalshi contracts moved 1¢ or more in the next 30 minutes,{" "}
                {measured.move.moved_before} in the 30 before
              </p>
            )}
            {measured?.move && mover && (
              <>
                <MoveChart mids={mover.mids!} t0={measured.move.t0 - (measured.move.t0 % 60_000)} label={mover.ticker} before={30} what="the item" />
                <p className="t-dim">
                  {mover.ticker} {signed(mover.move_cents)}
                </p>
              </>
            )}
          </Tool>
        )}
      </div>
    </section>
  );
}

const FAMILY = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.name]));

/** Four of the Insights page's answers as one number and one sentence each, computed the same way
 * from the same cached queries (insights/accuracy.tsx, crossing.tsx, news.tsx, spreads.tsx). */
async function Findings() {
  await connection(); // request time only: the build never queries the database
  const [cal, { pairs }, news, liq] = await Promise.all([
    calibrationAll(),
    getPairs(),
    getNews().catch((e) => {
      console.error(e);
      return null;
    }),
    getLiquidity(),
  ]);
  const worst = worstBand(cal.points, ["kalshi", "polymarket"]);
  const o = news && overall(news.moves);
  const diff = o ? Math.round(o.after - o.before) : 0;
  const spreads = liq.now.filter((r) => r.spread !== null).sort((a, b) => a.spread! - b.spread!);
  const market = (r: (typeof spreads)[number]) =>
    `${FAMILY.get(`${r.venue}/${r.family}`) ?? r.family} on ${r.venue === "kalshi" ? "Kalshi" : "Polymarket"}`;
  const found: [string, string, string][] = [];
  if (worst)
    found.push([
      "accuracy",
      `${(worst.hit * 100).toFixed(1)}%`,
      `of contracts priced ${worst.bucket * 10}–${worst.bucket * 10 + 10}¢ paid out; their price said ${(worst.pred * 100).toFixed(1)}% (${worst.n.toLocaleString("en-US")} predictions).`,
    ]);
  if (pairs.length)
    found.push([
      "crossing",
      `${arbitrage(pairs).length} of ${pairs.length}`,
      `questions listed on both venues pay after both fees right now. ${pairs.filter((p) => crossed(p)).length} cross before fees.`,
    ]);
  if (o)
    found.push([
      "news",
      diff === 0 ? "0" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`,
      `Kalshi contracts moving 1¢ or more in the 30 minutes after official news, against the 30 before (${Math.round(o.after)} against ${Math.round(o.before)}, over ${o.moments} moments).`,
    ]);
  if (spreads.length > 1)
    found.push([
      "spreads",
      `${c1(spreads[0].spread)} to ${c1(spreads.at(-1)!.spread)}`,
      `to cross the spread right now: ${market(spreads[0])} is the cheapest market, ${market(spreads.at(-1)!)} the dearest.`,
    ]);
  return (
    <section className="home-found">
      <div className="home-head">
        <span className="tag">From the recordings</span>
        <span>
          <Link href="/insights">Insights</Link>
        </span>
      </div>
      <div className="stats-row home-figures">
        <div className="figures-row">
          {found.map(([id, n, text]) => (
            <div key={id}>
              <b className="num">{n}</b>
              <span>{text}</span>
              <Link href={`/insights#${id}`} className="tool-open">
                The chart →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
