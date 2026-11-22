// An event: one question and every contract that answers it (each strike of "Bitcoin at 5 pm ET",
// each Fed outcome). One outcome is in focus (?o=<contract id>, by default the most informative):
// its chance, its chart against our fair value, a verdict in a sentence, and what a dollar amount
// buys. The contract page (/contract/...) keeps the full detail of a single contract.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import BuyBox from "@/components/BuyBox";
import { BookSection, Chart, RulesSection, TradesSection, unavailable } from "@/components/ContractSections";
import { closesIn, pct, ProbBar, Verdict } from "@/components/EventCard";
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
          <div className="focus">
            <span className="focus-pct num">{pct(m)}</span>
            <span className="focus-what">
              chance of <b>{outcomeLabel(o)}</b>
            </span>
          </div>
          <section className="panel chart-card">
            <Suspense fallback={<p className="muted pad">Loading the chart…</p>}>
              <Chart c={o} yesToken={tokens?.[0]} tracked={got?.tracked ?? false} />
            </Suspense>
          </section>
          <VerdictCard o={o} />
          <Tabs
            tabs={[
              {
                name: "Order book",
                pane: (
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <BookSection c={o} yesToken={tokens?.[0]} />
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
              {
                name: "Rules",
                pane: (
                  <Suspense fallback={<p className="muted">Loading…</p>}>
                    <RulesSection c={o} />
                  </Suspense>
                ),
              },
              {
                name: "How we price it",
                pane: (
                  <div className="prose-sm">
                    {o.fairMethod ? (
                      <p>
                        <b>{METHODS[o.fairMethod].name}.</b> {METHODS[o.fairMethod].explain}
                      </p>
                    ) : (
                      <p>We have no fair value for this contract yet.</p>
                    )}
                    <p>
                      Every number on this page, with the order book&apos;s full depth and the cost
                      of any size, is on the{" "}
                      <Link href={`/contract/${o.venue}/${encodeURIComponent(o.id)}`}>
                        contract&apos;s detail page
                      </Link>
                      .
                    </p>
                  </div>
                ),
              },
            ]}
          />
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
                      {outcomeLabel(x)} <Verdict o={x} />
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

/** The market against our fair value, as three numbers and one sentence. */
function VerdictCard({ o }: { o: Row }) {
  const m = mid(o);
  const f = usableFair(o);
  if (m === null) return null;
  if (f === null) {
    return (
      <section className="verdict-card">
        <div>
          <span>Market says</span>
          <b className="num">{pct(m)}</b>
        </div>
        <p>
          {o.fairMethod === "consensus-1"
            ? "Only one venue quotes this, so our estimate would just repeat its price: no second opinion here."
            : "We have no fair value for this contract yet."}
        </p>
      </section>
    );
  }
  const d = Math.round((f - m) * 1000) / 10; // points, one decimal; rounded first so 0 isn't "−0.0"
  const source = o.fairMethod === "options" ? "Options traders on Deribit" : "Both venues' quotes together";
  return (
    <section className="verdict-card">
      <div>
        <span>Market says</span>
        <b className="num">{(m * 100).toFixed(1)}%</b>
      </div>
      <div>
        <span>Manta&apos;s estimate</span>
        <b className="num fair">{(f * 100).toFixed(1)}%</b>
      </div>
      <div>
        <span>Difference</span>
        <b className={`num ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>
          {d > 0 ? "+" : d < 0 ? "−" : ""}
          {Math.abs(d).toFixed(1)} pts
        </b>
      </div>
      <p>
        {Math.abs(d) < 3 ? (
          <>The market and our estimate roughly agree.</>
        ) : d > 0 ? (
          <>
            <strong>&ldquo;Yes&rdquo; looks cheap.</strong> {source} put it {Math.abs(d).toFixed(0)}{" "}
            points higher than the market does.
          </>
        ) : (
          <>
            <strong>&ldquo;Yes&rdquo; looks pricey.</strong> {source} put it {Math.abs(d).toFixed(0)}{" "}
            points lower than the market does.
          </>
        )}{" "}
        A gap, not a guarantee: our estimate can be wrong, and the market may know something it
        doesn&apos;t. Not investment advice.
      </p>
    </section>
  );
}

async function Buy({ o, yesToken }: { o: Row; yesToken?: string }) {
  const book = o.venue === "kalshi" ? await kalshiBook(o.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", o.venue);
  return <BuyBox venue={o.venue} book={book} rate={o.feeTaker} fair={usableFair(o)} />;
}
