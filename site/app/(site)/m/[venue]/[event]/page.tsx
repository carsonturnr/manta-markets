// The Market page: one event (one question, "Bitcoin at 5 pm ET", "the Fed in December") and the
// outcome in focus (?o=<contract id>, by default the most informative). It shows the terminal's own
// panels (components/terminal/*), stacked in two columns on a desktop and one on a phone: the
// chart, the live book, depth and trades, the Bitcoin fair-value ladder; the cost to trade, fair
// value, the other venue's price, every outcome, the likely range, the AI brief; then the
// settlement rule. "Open in terminal" shows the same contract in the full workspace.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import { Chart, RulesSection, TradeLink } from "@/components/ContractSections";
import { closesIn, pct } from "@/components/EventCard";
import Live from "@/components/terminal/Live";
import VenueLogo from "@/components/VenueLogo";
import { BookPanel, CostPanel, DepthPanel, QuoteStrip, TapePanel } from "@/components/terminal/LivePanels";
import {
  BoardPanel,
  BriefPanel,
  DistPanel,
  FairPanel,
  LadderPanel,
  Panel,
  PairPanel,
} from "@/components/terminal/Panels";
import { getPairs } from "@/lib/compare";
import { getDistributions } from "@/lib/distributions";
import { getEvent } from "@/lib/events";
import { utc } from "@/lib/format";
import { featured, mid, outcomeLabel, usableFair } from "@/lib/outcomes";
import { getMarket, type Row } from "@/lib/screener";
import { SETTLEMENT, summary } from "@/lib/settlement";
import { polyTokens } from "@/lib/venues";

export const metadata = { title: "Manta: market" };

export default function MarketPage({ params, searchParams }: PageProps<"/m/[venue]/[event]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <MarketView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function MarketView({
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
          <Link href="/markets">Back to Markets</Link>.
        </p>
      </>
    );
  }
  const o = e.outcomes.find((x) => x.id === sp.o) ?? featured(e.outcomes, 1)[0];
  const [got, tokens, { pairs }, dists] = await Promise.all([
    getMarket(o.venue, o.id), // whether the BTC tracker has its fair-value history, and the read time
    venue === "polymarket" ? polyTokens(o.event, o.id) : null,
    getPairs(),
    getDistributions(),
  ]);
  const paired = pairs.some((p) => (o.venue === "kalshi" ? p.kalshi.ids : p.poly.ids).includes(o.id));
  const ladder = dists.some((d) => d.event === e.event);
  const btc = e.venue === "kalshi" && (e.family === "KXBTCD" || e.family === "KXBTC");
  const now = got?.at ?? e.close;
  const s = SETTLEMENT[e.family];
  const href = (x: Row) => `?o=${encodeURIComponent(x.id)}`;
  const wait = <p className="t-empty">Loading…</p>;
  return (
    <div className="mkt">
      <AutoRefresh seconds={15} />
      <p className="crumbs">
        <Link href="/markets">Markets</Link> · {e.category} ·{" "}
        <VenueLogo venue={e.venue} />
      </p>
      <h1>{e.question}</h1>
      <div className="event-sub">
        <span className="muted">
          Closes {utc(e.close)} ({closesIn(e.close, now)})
        </span>
        <span className="mkt-actions">
          <Link className="btn btn-sm" href={`/terminal?m=${encodeURIComponent(`${o.venue}:${o.id}`)}`}>
            Open in terminal
          </Link>
          <TradeLink c={o} />
        </span>
      </div>

      <Live venue={o.venue} id={o.id} token={tokens?.[0]}>
        <QuoteStrip
          lead={
            <div className="qs-lead">
              <span>
                Chance of <b>{outcomeLabel(o)}</b>
              </span>
              <b>{pct(mid(o))}</b>
            </div>
          }
        />
        <div className="mkt-grid">
          <div className="mkt-main">
            <Panel k="chart">
              <Suspense fallback={wait}>
                <Chart c={o} yesToken={tokens?.[0]} tracked={got?.tracked ?? false} />
              </Suspense>
            </Panel>
            <Panel k="book">
              <BookPanel fair={usableFair(o)} />
            </Panel>
            <Panel k="depth">
              <DepthPanel />
            </Panel>
            <Panel k="tape">
              <TapePanel />
            </Panel>
            {btc && (
              <Panel k="ladder">
                <Suspense fallback={wait}>
                  <LadderPanel e={e} />
                </Suspense>
              </Panel>
            )}
          </div>
          <div className="mkt-side">
            <Panel k="cost">
              <CostPanel venue={o.venue} rate={o.feeTaker} fair={usableFair(o)} />
            </Panel>
            <Panel k="fair" title="Fair value: a second opinion">
              <Suspense fallback={wait}>
                <FairPanel o={o} close={e.close} now={now} />
              </Suspense>
            </Panel>
            {paired && (
              <Panel k="pair">
                <Suspense fallback={wait}>
                  <PairPanel o={o} />
                </Suspense>
              </Panel>
            )}
            <Panel k="board" title={e.outcomes.length > 1 ? "Outcomes" : "Outcome"}>
              <BoardPanel e={e} focus={o.id} href={href} />
            </Panel>
            {ladder && (
              <Panel k="dist" title="Likely range">
                <Suspense fallback={wait}>
                  <DistPanel event={e.event} />
                </Suspense>
              </Panel>
            )}
            <Panel k="brief" title="Market brief">
              <Suspense fallback={wait}>
                <BriefPanel venue={o.venue} id={o.id} />
              </Suspense>
            </Panel>
          </div>
        </div>
      </Live>

      <section className="fine-print">
        <h2>How it settles</h2>
        <p>
          {summary(o)} at {utc(o.close)}
          {s && <>, measured as {s.settles}</>}.
        </p>
        <details>
          <summary>{o.venue === "kalshi" ? "Kalshi" : "Polymarket"}&apos;s own rules</summary>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <RulesSection c={o} />
          </Suspense>
        </details>
      </section>
    </div>
  );
}
