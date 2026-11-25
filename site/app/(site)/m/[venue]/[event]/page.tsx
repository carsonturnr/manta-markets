// An event, the simple view a trader lands on: one question and every contract that answers it
// (each strike of "Bitcoin at 5 pm ET", each Fed outcome). One outcome is in focus (?o=<contract id>,
// by default the most informative): its chance, chart, AI brief, order book and trades, what a
// dollar amount buys, our fair value, and a link to trade it on the venue. The contract page
// (/contract/...) is the detailed view of one contract; the terminal is the live workspace.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import BuyBox from "@/components/BuyBox";
import {
  BookSection,
  Chart,
  MarketBrief,
  RulesSection,
  TradeLink,
  TradesSection,
  unavailable,
} from "@/components/ContractSections";
import { closesIn, pct, ProbBar } from "@/components/EventCard";
import Tabs from "@/components/Tabs";
import { getEvent } from "@/lib/events";
import { utc } from "@/lib/format";
import { featured, mid, outcomeLabel, usableFair } from "@/lib/outcomes";
import type { Row } from "@/lib/screener";
import { METHODS, SETTLEMENT } from "@/lib/settlement";
import { getMarket } from "@/lib/screener";
import { kalshiBook, polyBook, polyTokens } from "@/lib/venues";

export const metadata = { title: "Manta: market" };

export default function EventPage({ params, searchParams }: PageProps<"/m/[venue]/[event]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <EventView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventView({
  params,
  searchParams,
}: Pick<PageProps<"/m/[venue]/[event]">, "params" | "searchParams">) {
  await connection(); // request time only: the build never queries the database
  const { venue, event: raw } = await params;
  const sp = await searchParams;
  if (venue !== "kalshi" && venue !== "polymarket") notFound();
  const e = await getEvent(venue, decodeURIComponent(raw));
  if (!e) {
    return (
      <>
        <h1>Not open</h1>
        <p className="muted">
          This market has closed, or has no contract quoted on both sides right now.{" "}
          <Link href="/">Back to today&apos;s markets</Link>.
        </p>
      </>
    );
  }
  const o = e.outcomes.find((x) => x.id === sp.o) ?? featured(e.outcomes, 1)[0];
  const got = await getMarket(o.venue, o.id); // whether the BTC tracker has its fair-value history
  const tokens = venue === "polymarket" ? await polyTokens(o.event, o.id) : null;
  const s = SETTLEMENT[e.family];
  const m = mid(o);
  const href = (x: Row) => `?o=${encodeURIComponent(x.id)}`;
  // On a long ladder, strikes priced under 2% or over 98% say little: list the ones in play (and
  // the one in focus), and count the rest.
  const inPlay = (x: Row) => x.id === o.id || e.outcomes.length <= 8 || ((mid(x) ?? 0) > 0.02 && (mid(x) ?? 1) < 0.98);
  const listed = e.outcomes.filter(inPlay);
  return (
    <div className="event-page">
      <AutoRefresh seconds={10} />
      <p className="crumbs">
        <Link href="/">Home</Link> · {e.category} ·{" "}
        <span className={`venue ${e.venue}`}>{e.venue === "kalshi" ? "Kalshi" : "Polymarket"}</span>
      </p>
      <h1>{e.question}</h1>
      <p className="muted event-sub">
        Closes {utc(e.close)} ({closesIn(e.close, got?.at ?? e.close)}){s && <> · settles on {s.settles}</>}
      </p>

      <div className="event-layout">
        <div className="event-main">
          <div className="focus-row">
            <div className="focus">
              <span className="focus-pct num">{pct(m)}</span>
              <span className="focus-what">
                chance of <b>{outcomeLabel(o)}</b>
              </span>
            </div>
            <TradeLink c={o} />
          </div>
          <p className="focus-help">
            The midpoint between the best prices to buy and sell &ldquo;yes&rdquo;, which pays $1 if
            it happens. A price of 40¢ reads as a 40% chance.
          </p>
          <section className="panel chart-card">
            <Suspense fallback={<p className="muted pad">Loading the chart…</p>}>
              <Chart c={o} yesToken={tokens?.[0]} tracked={got?.tracked ?? false} />
            </Suspense>
          </section>
          <Suspense fallback={null}>
            <MarketBrief c={o} />
          </Suspense>
          <Tabs
            tabs={[
              {
                name: "Order book",
                pane: (
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <BookSection c={o} yesToken={tokens?.[0]} levels={6} />
                  </Suspense>
                ),
              },
              {
                name: "Recent trades",
                pane: (
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <TradesSection c={o} yesToken={tokens?.[0]} />
                  </Suspense>
                ),
              },
            ]}
          />
          <FairValueCard o={o} />
          {/* The rules close the page: small print, read once, not a tab of their own. */}
          <section className="fine-print">
            <h2>Settlement rules</h2>
            <Suspense fallback={<p className="muted">Loading…</p>}>
              <RulesSection c={o} />
            </Suspense>
          </section>
          <p className="view-note">
            This is the simple view. The{" "}
            <Link href={`/contract/${o.venue}/${encodeURIComponent(o.id)}`}>contract page</Link> is
            the detailed one: the full book, the cost of any size, alerts. The{" "}
            <Link href="/terminal">terminal</Link> is the live workspace, streaming every market at
            once.
          </p>
        </div>

        <aside className="event-side">
          <section className="panel pad">
            <h2 className="card-h">Buy {outcomeLabel(o)}</h2>
            <Suspense fallback={<p className="muted">Loading the order book…</p>}>
              <Buy o={o} yesToken={tokens?.[0]} />
            </Suspense>
          </section>
          <section className="panel pad">
            <h2 className="card-h">
              {e.outcomes.length > 1 ? "Outcomes" : "Outcome"}
            </h2>
            <div className="ladder">
              {listed.map((x) => (
                <Link
                  key={x.id}
                  href={href(x)}
                  scroll={false}
                  className={x.id === o.id ? "ladder-row on" : "ladder-row"}
                >
                  <span className="outcome-lab">
                    <span>
                      {outcomeLabel(x)}
                    </span>
                    <ProbBar o={x} />
                  </span>
                  <b className="num">{pct(mid(x))}</b>
                </Link>
              ))}
            </div>
            {listed.length < e.outcomes.length && (
              <p className="note-sm">
                {e.outcomes.length - listed.length} more strikes priced under 2% or over 98% are
                hidden.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The midpoint beside our fair value, labelled with its method: one tool on the page, not a call. */
function FairValueCard({ o }: { o: Row }) {
  const m = mid(o);
  const f = usableFair(o);
  if (m === null) return null;
  if (f === null) {
    return (
      <section className="verdict-card">
        <div>
          <span>Midpoint</span>
          <b className="num">{pct(m)}</b>
        </div>
        <p>
          {o.fairMethod === "consensus-1"
            ? "Only one venue quotes this, so a fair value would just repeat its price."
            : "No fair value for this contract yet."}
        </p>
      </section>
    );
  }
  const d = Math.round((f - m) * 1000) / 10; // points, one decimal; rounded first so 0 isn't "−0.0"
  const method = o.fairMethod ? METHODS[o.fairMethod].name : "Fair value";
  return (
    <section className="verdict-card">
      <div>
        <span>Midpoint</span>
        <b className="num">{(m * 100).toFixed(1)}%</b>
      </div>
      <div>
        <span>Fair value</span>
        <b className="num fair">{(f * 100).toFixed(1)}%</b>
      </div>
      <div>
        <span>Difference</span>
        <b className={`num ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>
          {d > 0 ? "+" : d < 0 ? "−" : ""}
          {Math.abs(d).toFixed(1)} points
        </b>
      </div>
      <p>
        Fair value is Manta&apos;s own estimate of the chance ({method.toLowerCase()}): a reference
        price, not a forecast to trade on. How it is made and how accurate it has been:{" "}
        <Link href="/stats">accuracy page</Link>. Not investment advice.
      </p>
    </section>
  );
}

async function Buy({ o, yesToken }: { o: Row; yesToken?: string }) {
  const book = o.venue === "kalshi" ? await kalshiBook(o.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", o.venue);
  return <BuyBox venue={o.venue} book={book} rate={o.feeTaker} />;
}
