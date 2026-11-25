// The trader workspace (step 12): one full screen of panels around the contract in focus. The focus
// is in the URL (?m=kalshi:TICKER or ?m=polymarket:0x…), so a view can be shared, and so is the
// layout preset (?layout=market|monitor|arb|catalysts). Live panels (book, depth, tape, ticket)
// poll /api/live every 2 s; the rest re-render from the server every 15 s.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import AccountNav from "@/components/AccountNav";
import AutoRefresh from "@/components/AutoRefresh";
import { Chart } from "@/components/ContractSections";
import Mark from "@/components/Mark";
import Live from "@/components/terminal/Live";
import { BookPanel, DepthPanel, TapePanel, TicketPanel } from "@/components/terminal/LivePanels";
import Monitor from "@/components/terminal/Monitor";
import Palette, { type Command } from "@/components/terminal/Palette";
import { AlertsPanel, ArbPanel, BoardPanel, CalendarPanel, DistPanel, FairPanel } from "@/components/terminal/Panels";
import { monitorRows } from "@/lib/monitor";
import { getEvents } from "@/lib/events";
import { utc } from "@/lib/format";
import { featured, mid, outcomeLabel, usableFair, whenET } from "@/lib/outcomes";
import { getMarket } from "@/lib/screener";
import { polyTokens } from "@/lib/venues";

export const metadata = { title: "Manta terminal" };

type Params = Record<string, string | string[] | undefined>;
type PanelKey = "mon" | "chart" | "book" | "depth" | "tape" | "ticket" | "fair" | "board" | "arb" | "dist" | "cal" | "alerts";

// Each preset is a CSS grid (its areas are in globals.css, .t-grid-<name>) and the panels it shows.
const LAYOUTS: Record<string, { name: string; panels: PanelKey[] }> = {
  market: { name: "Market", panels: ["mon", "chart", "book", "depth", "fair", "ticket", "tape", "board", "alerts"] },
  monitor: { name: "Monitor", panels: ["mon", "chart", "arb", "cal"] },
  arb: { name: "Cross-venue", panels: ["arb", "chart", "book", "depth", "tape"] },
  catalysts: { name: "Catalysts", panels: ["cal", "dist", "board", "fair", "chart"] },
};

// The short code and title shown on each panel's header.
const TITLES: Record<PanelKey, [string, string]> = {
  mon: ["MON", "Markets"],
  chart: ["GP", "Price"],
  book: ["BOOK", "Order book"],
  depth: ["DPTH", "Depth and liquidity"],
  tape: ["TAPE", "Trades"],
  ticket: ["TKT", "Ticket"],
  fair: ["FV", "Fair value"],
  board: ["EVT", "Every outcome"],
  arb: ["ARB", "Cross-venue arbitrage"],
  dist: ["DIST", "Implied distribution"],
  cal: ["CAL", "Catalysts"],
  alerts: ["ALRT", "Alerts"],
};

const pct = (p: number | null) => (p === null ? "–" : `${(Math.round(p * 1000) / 10).toFixed(1)}%`);
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

export default function Terminal({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense fallback={<div className="terminal" />}>
      <Workspace searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspace({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const p = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const layoutKey = one(p.layout) in LAYOUTS ? one(p.layout) : "market";
  const layout = LAYOUTS[layoutKey];
  const { events, at } = await getEvents();
  const now = at ?? 0; // the listing's read time: "now" for this data

  // The contract in focus: the one asked for, or today's busiest Bitcoin ladder's most informative.
  const [fv, ...rest] = one(p.m).split(":");
  const fid = rest.join(":");
  let e = events.find((x) => x.venue === fv && x.outcomes.some((o) => o.id === fid));
  let o = e?.outcomes.find((x) => x.id === fid);
  if (!e || !o) {
    e =
      events.filter((x) => x.family === "KXBTCD" && x.close - now > 3_600_000).sort((a, b) => a.close - b.close)[0] ??
      events[0];
    o = featured(e.outcomes, 1)[0];
  }
  const [market, tokens] = await Promise.all([
    getMarket(o.venue, o.id),
    o.venue === "polymarket" ? polyTokens(o.event, o.id) : null,
  ]);
  const has = (k: PanelKey) => layout.panels.includes(k);
  const focus = `${o.venue}:${o.id}`;
  const fair = usableFair(o);

  const rows = monitorRows(events);
  const commands: Command[] = [
    ...Object.entries(LAYOUTS).map(([k, l]) => ({
      label: `Layout: ${l.name}`,
      hint: l.panels.map((x) => TITLES[x][0]).join(" "),
      href: `/terminal?m=${encodeURIComponent(focus)}&layout=${k}`,
    })),
    ...rows.map((r) => ({
      label: r.question,
      hint: `${r.venue === "kalshi" ? "Kalshi" : "Polymarket"} · ${r.category}`,
      href: `/terminal?m=${encodeURIComponent(`${r.venue}:${r.focusId}`)}&layout=${layoutKey}`,
    })),
  ];

  const panel = (k: PanelKey, body: React.ReactNode) =>
    has(k) ? (
      <section key={k} className="t-panel" style={{ gridArea: k }}>
        <header>
          <span className="t-code">{TITLES[k][0]}</span>
          <h2>{TITLES[k][1]}</h2>
        </header>
        <div className="t-body">{body}</div>
      </section>
    ) : null;
  const wait = <p className="t-empty">Loading…</p>;

  return (
    <div className="terminal">
      <AutoRefresh seconds={15} />
      <header className="t-top">
        <Link href="/" className="t-brand" aria-label="Manta, home">
          <Mark /> Manta <span className="t-dim">Terminal</span>
        </Link>
        <nav className="t-layouts" aria-label="Layouts">
          {Object.entries(LAYOUTS).map(([k, l]) => (
            <Link
              key={k}
              href={`/terminal?m=${encodeURIComponent(focus)}&layout=${k}`}
              className={k === layoutKey ? "on" : undefined}
              scroll={false}
            >
              {l.name}
            </Link>
          ))}
        </nav>
        <Palette commands={commands} />
        <nav className="t-links" aria-label="Tools">
          <Link href="/markets">Markets</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/liquidity">Liquidity</Link>
          <Link href="/distributions">Distributions</Link>
          <Link href="/replay">Replay</Link>
        </nav>
        <AccountNav />
      </header>

      <div className="t-focus num">
        <span className={`t-venue ${o.venue}`}>{o.venue === "kalshi" ? "Kalshi" : "Polymarket"}</span>
        <b className="t-focus-q">{e.question}</b>
        <span className="t-focus-o">{outcomeLabel(o)}</span>
        <span>
          <span className="t-dim">Mid</span> <b>{pct(mid(o))}</b>
        </span>
        <span>
          <span className="t-dim">Bid / ask</span> {cents(o.bid)} / {cents(o.ask)}
        </span>
        <span>
          <span className="t-dim">Fair</span> <b className="t-mint">{pct(fair)}</b>
        </span>
        <span>
          <span className="t-dim">Closes</span> {whenET(e.close, now)}
        </span>
        <Link href={`/contract/${o.venue}/${encodeURIComponent(o.id)}`} className="t-dim">
          Contract page →
        </Link>
      </div>

      <Live venue={o.venue} id={o.id} token={tokens?.[0]}>
        <div className={`t-grid t-grid-${layoutKey}`}>
          {panel("mon", <Monitor rows={rows} focus={focus} layout={layoutKey} now={now} />)}
          {panel(
            "chart",
            <Suspense fallback={wait}>
              <Chart c={o} yesToken={tokens?.[0]} tracked={market?.tracked ?? false} />
            </Suspense>,
          )}
          {panel("book", <BookPanel fair={fair} />)}
          {panel("depth", <DepthPanel />)}
          {panel("tape", <TapePanel />)}
          {panel("ticket", <TicketPanel venue={o.venue} rate={o.feeTaker} />)}
          {panel(
            "fair",
            <Suspense fallback={wait}>
              <FairPanel o={o} close={e.close} now={now} />
            </Suspense>,
          )}
          {panel("board", <BoardPanel e={e} focus={o.id} layout={layoutKey} />)}
          {panel(
            "arb",
            <Suspense fallback={wait}>
              <ArbPanel events={events} layout={layoutKey} />
            </Suspense>,
          )}
          {panel(
            "dist",
            <Suspense fallback={wait}>
              <DistPanel event={e.event} />
            </Suspense>,
          )}
          {panel("cal", <CalendarPanel events={events} now={now} layout={layoutKey} />)}
          {panel(
            "alerts",
            <Suspense fallback={wait}>
              <AlertsPanel venue={o.venue} id={o.id} />
            </Suspense>,
          )}
        </div>
      </Live>

      <footer className="t-status">
        <span>Listing read {at ? utc(at) : "–"}</span>
        <span>Books and trades every 2 s from Kalshi&apos;s and Polymarket&apos;s public APIs</span>
        <Link href="/quality">Data quality</Link>
        <span>
          Charts by <a href="https://www.tradingview.com/">TradingView</a>
        </span>
        <span>Calculators only: Manta places no orders. Not investment advice.</span>
      </footer>
    </div>
  );
}
