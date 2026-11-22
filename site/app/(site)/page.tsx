// Home: what Manta does, shown on today's Bitcoin ladder; the contracts where Manta disagrees most
// with the market; the questions everyone is watching; then the busiest markets. Built from the
// listing grouped into events (lib/events.ts) and the implied distributions; nothing new is stored.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import EventCard, { eventHref, pct } from "@/components/EventCard";
import HeroChart from "@/components/HeroChart";
import WaitlistForm from "@/components/WaitlistForm";
import { fmtValue, getDistributions } from "@/lib/distributions";
import { crossed, getPairs } from "@/lib/compare";
import { type Event, getEvents } from "@/lib/events";
import { getReport } from "@/lib/quality";
import { mid, outcomeLabel, usableFair, verdict } from "@/lib/outcomes";

type Params = Record<string, string | string[] | undefined>;

// The filters above the markets; each is a link, so a filtered view can be shared.
const FILTERS = ["All", "Crypto", "Economics", "Financials", "Closing today", "Manta disagrees"] as const;
type Filter = (typeof FILTERS)[number];

export default function Home({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <section className="hero">
        <h1>Prediction market prices, checked against a second opinion.</h1>
        <p>
          Manta reads every crypto, economics and financial contract on Kalshi and Polymarket as a
          probability, then prices it again from Deribit&apos;s options and the other venue. Where
          the two disagree, you see it. No sports.
        </p>
        <Link href="/screener" className="btn">
          Browse markets
        </Link>
      </section>

      <Suspense fallback={<div className="panel hero-card" />}>
        <Hero />
      </Suspense>

      <Suspense fallback={<div className="stats-row" />}>
        <Stats />
      </Suspense>

      <Suspense fallback={<section className="band" />}>
        <Disagreements />
      </Suspense>

      <Suspense fallback={<section className="split-sec" />}>
        <Watching />
      </Suspense>

      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>

      <section className="cta-box">
        <span className="tag">Coming next</span>
        <h2>Get an alert when a market moves</h2>
        <p className="muted">
          Accounts with watchlists, email alerts and an API are next. One email when they open.
        </p>
        <WaitlistForm />
      </section>
    </>
  );
}

/** Three figures about what Manta covers, under a strip of today's events sized by volume. */
async function Stats() {
  await connection(); // request time only: the build never queries the database
  const [{ events }, { pairs }, quality] = await Promise.all([getEvents(), getPairs(), getReport()]);
  const contracts = events.reduce((n, e) => n + e.outcomes.length, 0);
  const afterFees = pairs.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
  const worst = quality?.report.venues.reduce((w, v) => (v.coverage < w.coverage ? v : w), quality.report.venues[0]);
  const total = events.reduce((n, e) => n + e.volume, 0) || 1;
  return (
    <section className="stats-row">
      {/* Each event as a segment, its width its share of today's volume, coloured by category. */}
      <div className="strip" aria-hidden="true">
        {events.slice(0, 60).map((e) => (
          <i key={`${e.venue}/${e.event}`} className={`cat-${e.category.split(" ")[0].toLowerCase()}`} style={{ flexGrow: e.volume / total }} />
        ))}
      </div>
      <div className="figures-row">
        <div>
          <b className="num">{contracts.toLocaleString("en-US")}</b>
          <span>contracts priced every minute</span>
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

/** Today's Bitcoin ladder (the next one more than an hour from its close), drawn. */
async function Hero() {
  await connection(); // request time only: the build never queries the database
  const { events, at } = await getEvents();
  const now = at ?? 0; // the listing's read time: "now" for this data
  const e = events
    .filter((x) => x.family === "KXBTCD" && x.close - now > 3_600_000)
    .sort((a, b) => a.close - b.close)[0];
  if (!e) return <div className="panel hero-card" />;
  return (
    <Link href={eventHref(e)} className="hero-card">
      <div className="callouts">
        <span className="callout">
          <span className="tag">
            <i className="key-line" /> Market
          </span>
          <span className="mono">Kalshi&apos;s prices</span>
        </span>
        <span className="callout-q">{e.question}</span>
        <span className="callout right">
          <span className="tag">
            <i className="key-buoy" /> Manta
          </span>
          <span className="mono">Fair value from Deribit&apos;s options</span>
        </span>
      </div>
      <div className="panel hero-chart-card">
        <HeroChart outcomes={e.outcomes} family={e.family} />
        <p className="note">The chance Bitcoin ends above each price. Mint lines: where Manta and the market differ by 3 points or more.</p>
      </div>
    </Link>
  );
}

/** The liquid contracts where our fair value and the market are furthest apart. */
async function Disagreements() {
  await connection();
  const { events } = await getEvents();
  const rows = events
    .flatMap((e) => e.outcomes.map((o) => ({ e, o })))
    .filter(({ o }) => o.volume > 0 && o.bid !== null && o.ask !== null && o.ask - o.bid <= 0.05)
    .filter(({ o }) => verdict(o) !== null)
    .map((r) => ({ ...r, gap: usableFair(r.o)! - mid(r.o)! }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .slice(0, 6);
  return (
    <section className="band">
      <span className="tag">The second opinion</span>
      <h2>Where Manta disagrees most</h2>
      <p className="band-sub">Contracts traded today with a spread of 5¢ or less, ranked by the gap between the market and Manta&apos;s fair value.</p>
      <p className="band-legend">
        <span>
          <i className="db-key market" /> Market
        </span>
        <span>
          <i className="db-key manta" /> Manta
        </span>
        <span className="m3">0% to 100% chance of &ldquo;yes&rdquo;</span>
      </p>
      {rows.length === 0 ? (
        <p className="muted pad">No gaps of 3 points or more right now.</p>
      ) : (
        <ol className="ranked">
          {rows.map(({ e, o, gap }) => (
            <li key={o.id}>
              <Link href={`${eventHref(e)}?o=${encodeURIComponent(o.id)}`} className="row-link">
                <span className="ranked-q">
                  <b>{outcomeLabel(o)}</b>
                  <span className="m3">{e.question}</span>
                </span>
                <Dumbbell market={mid(o)!} manta={usableFair(o)!} />
                <span className={`gap-pts ${gap > 0 ? "up" : "down"}`}>
                  {gap > 0 ? "+" : "−"}
                  {(Math.abs(gap) * 100).toFixed(1)} pts
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="band-note">
        Green: Manta prices &ldquo;yes&rdquo; above the market, so it looks cheap. Red: below. A
        gap, not a guarantee.
      </p>
    </section>
  );
}

/** Two probabilities on one 0–100% track: the market's dot, Manta's mint dot, the line between
 * them is the disagreement. Each dot carries its value. */
function Dumbbell({ market, manta }: { market: number; manta: number }) {
  const lo = Math.min(market, manta);
  const hi = Math.max(market, manta);
  return (
    <span className="dumbbell" aria-label={`Market ${pct(market)}, Manta ${pct(manta)}`}>
      <span className="db-track" />
      <span className="db-gap" style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />
      <span className="db-dot market" style={{ left: `${market * 100}%` }}>
        <span className="db-val">{pct(market)}</span>
      </span>
      <span className="db-dot manta" style={{ left: `${manta * 100}%` }}>
        <span className="db-val">{pct(manta)}</span>
      </span>
    </span>
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
        <span className="tag">Right now</span>
        <h2>What the markets expect</h2>
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
    case "Manta disagrees":
      return events.filter((e) => e.outcomes.some((o) => verdict(o) !== null));
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
