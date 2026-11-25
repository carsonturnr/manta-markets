// Home, the terminal's front door: what Manta covers, the tools with a live figure each, the
// busiest markets, the widest cross-venue gaps and what the ladders imply. Built from the queries
// the tools already use (events, pairs, distributions, liquidity, quality); nothing new is stored.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import EventCard, { eventHref, pct } from "@/components/EventCard";
import { BookSection } from "@/components/ContractSections";
import DistChart from "@/components/DistChart";
import WaitlistForm from "@/components/WaitlistForm";
import { fmtValue, getDistributions } from "@/lib/distributions";
import { crossed, gap, getPairs } from "@/lib/compare";
import { type Event, getEvents } from "@/lib/events";
import { getLiquidity } from "@/lib/liquidity";
import { getReport } from "@/lib/quality";
import { featured, mid, outcomeLabel } from "@/lib/outcomes";

type Params = Record<string, string | string[] | undefined>;

// The filters above the markets; each is a link, so a filtered view can be shared.
const FILTERS = ["All", "Crypto", "Economics", "Financials", "Closing today"] as const;
type Filter = (typeof FILTERS)[number];

export default function Home({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <section className="hero hero-split">
        <div className="hero-copy">
          <h1>A terminal for prediction markets.</h1>
          <p>
            Every crypto, economics and financial contract on Kalshi and Polymarket in one place: a
            screener, live order books and trades, the same question compared across venues, what a
            trade really costs after fees, implied distributions, replay and alerts. No sports.
          </p>
          <Link href="/terminal" className="btn">
            Open the terminal
          </Link>
        </div>
        <Suspense fallback={<div className="panel preview" />}>
          <Preview />
        </Suspense>
      </section>

      <Suspense fallback={<div className="stats-row" />}>
        <Stats />
      </Suspense>

      <Suspense fallback={<section className="band" />}>
        <Tools />
      </Suspense>

      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<section className="split-sec" />}>
        <CrossVenue />
      </Suspense>

      <Suspense fallback={<section className="split-sec" />}>
        <Watching />
      </Suspense>

      <section className="cta-box">
        <span className="tag">Coming next</span>
        <h2>An API for Manta&apos;s analytics</h2>
        <p className="muted">
          Fair values, distributions, costs to trade and cross-venue gaps, with keys. One email when
          it opens.
        </p>
        <WaitlistForm />
      </section>
    </>
  );
}

/** The hero's picture of the product: four of the terminal's panels on live data. The busiest
 * Kalshi event's ladder and its featured contract's order book, one implied distribution and the
 * best cross-venue arbitrage after fees, from the same queries and components the tools use. */
async function Preview() {
  await connection(); // request time only: the build never queries the database
  const [{ events, at }, { pairs }, dists] = await Promise.all([getEvents(), getPairs(), getDistributions()]);
  const top = events.find((e) => e.venue === "kalshi"); // the order book below reads Kalshi's
  const o = top ? featured(top.outcomes, 1)[0] : undefined;
  const ok = dists.filter((x) => x.curve.length > 4);
  const d = ok.find((x) => x.title.includes("Bitcoin")) ?? ok[0];
  const arbs = pairs
    .flatMap((p) => {
      const x = crossed(p);
      return x && x.net !== null && x.net > 1e-9 ? [{ p, x }] : [];
    })
    .sort((a, b) => b.x.net! - a.x.net!)
    .slice(0, 3);
  return (
    <div className="panel preview">
      <div className="pv-bar num">
        <span className="pv-live">Live</span>
        <span>Manta terminal</span>
        <span>{at !== null ? `${new Date(at).toISOString().slice(11, 16)} UTC` : ""}</span>
      </div>
      <div className="pv-grid">
        <div className="pv-cell">{top && <EventCard e={top} now={at ?? top.close} />}</div>
        <div className="pv-cell">
          <Link href="/terminal" className="pv-h">
            Order book{o && <span className="m3"> · {outcomeLabel(o)}</span>}
          </Link>
          {o && <BookSection c={o} levels={4} />}
        </div>
        <div className="pv-cell">
          <Link href="/distributions" className="pv-h">
            Implied distribution{d && <span className="m3"> · {d.title}</span>}
          </Link>
          {d && <DistChart d={d} width={380} />}
        </div>
        <div className="pv-cell">
          <Link href="/compare" className="pv-h">
            Arbitrage after fees
          </Link>
          {arbs.length === 0 ? (
            <p className="muted small">None right now: prices checked every minute.</p>
          ) : (
            <ul className="pv-arbs num">
              {arbs.map(({ p, x }) => (
                <li key={`${p.topic}/${p.question}`}>
                  <span>
                    {p.question}
                    <small>
                      {p.topic} · buy {x.buy}, sell {x.sell}
                    </small>
                  </span>
                  <b className="up">+{x.net!.toFixed(2)}¢</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Three figures about what Manta covers. */
async function Stats() {
  await connection(); // request time only: the build never queries the database
  const [{ events }, { pairs }, quality] = await Promise.all([getEvents(), getPairs(), getReport()]);
  const contracts = events.reduce((n, e) => n + e.outcomes.length, 0);
  const afterFees = pairs.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
  const worst = quality?.report.venues.reduce((w, v) => (v.coverage < w.coverage ? v : w), quality.report.venues[0]);
  return (
    <section className="stats-row">
      <div className="figures-row">
        <div>
          <b className="num">{contracts.toLocaleString("en-US")}</b>
          <span>contracts, quotes refreshed every minute</span>
        </div>
        <div>
          <b className="num">{pairs.length}</b>
          <span>
            questions listed on both venues, {afterFees} crossing after fees
          </span>
        </div>
        <div>
          <b className="num">{worst ? `${(worst.coverage * 100).toFixed(1)}%` : "–"}</b>
          <span>recorder coverage, worst venue</span>
        </div>
      </div>
    </section>
  );
}

/** What you can open, each with one live figure from the data the tool itself reads. Fair value
 * is one tool in the list, labelled with its methods; its accuracy is a research page. */
async function Tools() {
  await connection(); // request time only: the build never queries the database
  const [{ events }, { pairs }, dists, liq] = await Promise.all([
    getEvents(),
    getPairs(),
    getDistributions(),
    getLiquidity(),
  ]);
  const contracts = events.reduce((n, e) => n + e.outcomes.length, 0);
  const afterFees = pairs.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
  const spreads = liq.now.map((x) => x.spread).filter((x): x is number => x !== null);
  const tightest = spreads.length ? Math.min(...spreads) : null;
  const tools: { href: string; name: string; text: string; figure: string; unit: string }[] = [
    {
      href: "/terminal",
      name: "Terminal",
      text: "One screen per contract: live order book, depth, trades, the event's ladder and a command palette.",
      figure: "Live",
      unit: "books and trades",
    },
    {
      href: "/screener",
      name: "Screener",
      text: "Every covered contract, filtered by venue, category and expiry, sorted by volume, spread or price.",
      figure: contracts.toLocaleString("en-US"),
      unit: "contracts",
    },
    {
      href: "/compare",
      name: "Cross-venue compare",
      text: "The same question on Kalshi and Polymarket side by side, with crossing prices checked after both venues' fees.",
      figure: String(pairs.length),
      unit: `pairs, ${afterFees} crossing after fees`,
    },
    {
      href: "/liquidity",
      name: "Cost to trade and liquidity",
      text: "What N contracts really cost after walking the book and paying fees; spreads and depth by hour of day.",
      figure: tightest === null ? "–" : `${(tightest * 100).toFixed(1)}¢`,
      unit: "tightest median spread now",
    },
    {
      href: "/distributions",
      name: "Distributions and term structure",
      text: "A ladder of strikes read as a probability distribution, with its median, range and implied volatility.",
      figure: String(dists.length),
      unit: "ladders right now",
    },
    {
      href: "/replay",
      name: "History and replay",
      text: "Any recorded close replayed minute by minute: the book, the trades and the price. Kalshi keeps no book history; we do.",
      figure: "1 min",
      unit: "resolution",
    },
    {
      href: "/account",
      name: "Watchlists and alerts",
      text: "Save contracts and get an email when a price crosses a level you set.",
      figure: "Email",
      unit: "alerts",
    },
    {
      href: "/stats",
      name: "Fair value",
      text: "A reference price for each contract, labelled by method (Deribit's options for crypto, both venues' quotes elsewhere), with its measured accuracy.",
      figure: "2",
      unit: "methods, scored",
    },
  ];
  return (
    <section className="band tools-band">
      <span className="tag">The tools</span>
      <h2>Everything a prediction-market trader reads, in one place</h2>
      <p className="band-sub">
        Crypto, economics and financial contracts on Kalshi and Polymarket, recorded from both
        venues&apos; live feeds.
      </p>
      <ol className="ranked">
        {tools.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="row-link">
              <span className="ranked-q">
                <b>{t.name}</b>
                <span>{t.text}</span>
              </span>
              <span className="ranked-fig num">
                {t.figure}
                <span className="m3">{t.unit}</span>
              </span>
              <span className="gap-pts">Open →</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The pairs listed on both venues with the widest price gap, and whether they cross after fees. */
async function CrossVenue() {
  await connection();
  const { pairs } = await getPairs();
  const rows = pairs
    .map((p) => ({ p, g: gap(p), x: crossed(p) }))
    .filter((r) => r.g !== null && !r.g.inside)
    .sort((a, b) => Math.abs(b.g!.cents) - Math.abs(a.g!.cents))
    .slice(0, 4);
  const c = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}¢`);
  return (
    <section className="split-sec">
      <div>
        <span className="tag">Cross-venue</span>
        <h2>Same question, two prices</h2>
        <Link href="/compare" className="text-link">
          All {pairs.length} pairs →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No priced pairs right now.</p>
      ) : (
        <ul className="watching">
          {rows.map(({ p, g, x }) => (
            <li key={`${p.topic}/${p.question}`}>
              <Link href="/compare" className="row-link">
                <span className="mono">
                  {p.topic}: {p.question}
                </span>
                <b className="num">{Math.abs(g!.cents).toFixed(1)}¢</b>
                <span className="m2">
                  Kalshi {c(p.kalshi.bid)}–{c(p.kalshi.ask)}, Polymarket {c(p.poly.bid)}–{c(p.poly.ask)}
                  {x && x.net !== null && (
                    <>
                      {": "}buy on {x.buy}, sell on {x.sell},{" "}
                      {x.net > 1e-9 ? `${x.net.toFixed(1)}¢ after fees` : "gone after fees"}
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The questions everyone is watching, in one sentence each. */
async function Watching() {
  await connection();
  const [dists, { events, at }] = await Promise.all([getDistributions(), getEvents()]);
  const now = at ?? 0;
  const btc = dists.find((d) => d.family === "KXBTCD" && d.close - now > 3_600_000 && d.median !== null);
  const cpi = dists.find((d) => d.family === "KXCPIYOY" && d.median !== null);
  const fed = events.filter((e) => e.family === "KXFEDDECISION").sort((a, b) => a.close - b.close)[0];
  const day = (t: number) =>
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(t);
  const find = (event: string) => events.find((e) => e.event === event);
  const items: { href: string; label: string; figure: string; text: string }[] = [];
  if (btc) {
    const e = find(btc.event);
    items.push({
      href: e ? eventHref(e) : "/distributions",
      label: e ? e.question.replace("Where will ", "").replace(" be at", " at").replace("?", "") : "Bitcoin",
      figure: fmtValue(btc.family, btc.median),
      text: `even odds between ${fmtValue(btc.family, btc.q25)} and ${fmtValue(btc.family, btc.q75)}`,
    });
  }
  if (fed?.outcomes[0]) {
    items.push({
      href: eventHref(fed),
      label: `The Fed, ${day(fed.close)}`,
      figure: pct(mid(fed.outcomes[0])),
      text: `chance of “${fed.outcomes[0].label}”`,
    });
  }
  if (cpi) {
    const e = find(cpi.event);
    items.push({
      href: e ? eventHref(e) : "/distributions",
      label: `Inflation, released ${day(cpi.close)}`,
      figure: fmtValue(cpi.family, cpi.median),
      text: `most likely yearly CPI, even odds ${fmtValue(cpi.family, cpi.q25)} to ${fmtValue(cpi.family, cpi.q75)}`,
    });
  }
  return (
    <section className="split-sec">
      <div>
        <span className="tag">Implied distributions</span>
        <h2>What the ladders imply</h2>
        <Link href="/distributions" className="text-link">
          All distributions →
        </Link>
      </div>
      <ul className="watching">
        {items.map((i) => (
          <li key={i.label}>
            <Link href={i.href} className="row-link">
              <span className="mono">{i.label}</span>
              <b className="num">{i.figure}</b>
              <span className="m2">{i.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function pick(events: Event[], f: Filter, now: number): Event[] {
  switch (f) {
    case "Crypto":
    case "Economics":
    case "Financials":
      return events.filter((e) => e.category === f);
    case "Closing today":
      return events.filter((e) => e.close - now < 86_400_000);
    default:
      return events;
  }
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
        <h2>Busiest markets</h2>
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
        <Link href="/screener" className="right text-link">
          All markets →
        </Link>
      </div>
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
