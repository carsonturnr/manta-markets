import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import {
  BookSection,
  Chart,
  CostSection,
  RulesSection,
  TradesSection,
  Watch,
} from "@/components/ContractSections";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getMarket, type Row } from "@/lib/screener";
import { METHODS, SETTLEMENT, summary } from "@/lib/settlement";
import { polyTokens } from "@/lib/venues";

export const metadata = { title: "Manta: contract" };

export default function ContractPage({
  params,
  searchParams,
}: PageProps<"/contract/[venue]/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Contract params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Cents with at most one decimal: 0.42 → "42¢", 0.918 → "91.8¢". */
const cents = (p: number | null | undefined) =>
  p === null || p === undefined ? "–" : `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

/** Time to close from the listing's time: "38 min", "5 h 12 min", "3 days". */
function until(close: number, at: number): string {
  const m = Math.round((close - at) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.floor(m / 60)} h ${m % 60} min`;
  return `in ${Math.round(m / 1440)} days`;
}

async function Contract({
  params,
  searchParams,
}: Pick<PageProps<"/contract/[venue]/[id]">, "params" | "searchParams">) {
  await connection(); // request time only: the build never queries the database
  const { venue, id: rawId } = await params;
  const sp = await searchParams;
  const side = sp.side === "sell" ? "sell" : "buy";
  const n = Math.min(Math.max(Number.parseInt(String(sp.n ?? "100"), 10) || 100, 1), 1_000_000);
  if (venue !== "kalshi" && venue !== "polymarket") notFound();
  const id = decodeURIComponent(rawId);
  const got = await getMarket(venue, id);
  if (!got) {
    return (
      <>
        <h1>Not listed</h1>
        <p className="muted">
          This contract isn&apos;t open on {venue === "kalshi" ? "Kalshi" : "Polymarket"} among the
          families Manta covers: it has closed, or it was never covered.{" "}
          <Link href="/screener">Back to the screener</Link>.
        </p>
      </>
    );
  }
  const { row: c, tracked, at } = got;
  const family = FAMILIES.find((f) => f.family === c.family);
  const s = SETTLEMENT[c.family];
  const venueName = venue === "kalshi" ? "Kalshi" : "Polymarket";
  const tokens = venue === "polymarket" ? await polyTokens(c.event, c.id) : null;

  const fairUsable = c.fair !== null && c.fairMethod !== null && c.fairMethod !== "consensus-1";

  return (
    <div className="workspace">
      <AutoRefresh seconds={10} />
      <section className="panel cw-head">
        <div className="cw-title">
          <p className="crumbs">
            <span className={`venue ${venue}`}>{venueName}</span> ·{" "}
            <Link href={`/screener?family=${c.family}`}>{family?.name ?? c.family}</Link> ·{" "}
            <span className="id">{venue === "kalshi" ? c.id : c.event}</span>
          </p>
          <h1>{summary(c)}</h1>
          <p className="muted">
            Closes {utc(c.close)} ({until(c.close, at)}).
            {s && <> Settles on {s.settles}.</>}
          </p>
        </div>
        <Quote c={c} />
      </section>

      <div className="cw-grid">
        <section className="panel cw-chart">
          <Suspense fallback={<p className="muted pad">Loading the chart…</p>}>
            <Chart c={c} yesToken={tokens?.[0]} tracked={tracked} />
          </Suspense>
        </section>

        <section className="panel cw-book">
          <header className="ph">
            <h2>Order book</h2>
            <span className="m3">&ldquo;yes&rdquo;, live</span>
          </header>
          <Suspense fallback={<p className="muted pad">Loading…</p>}>
            <BookSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>

        <section className="panel cw-cost">
          <header className="ph">
            <h2>Cost to trade</h2>
            <span className="m3">walks the live book, then adds {venueName}&apos;s taker fee</span>
          </header>
          <Suspense fallback={<p className="muted pad">Loading the order book…</p>}>
            <CostSection c={c} yesToken={tokens?.[0]} side={side} n={n} fairUsable={fairUsable} />
          </Suspense>
        </section>

        <section className="panel cw-trades">
          <header className="ph">
            <h2>Trades</h2>
            <span className="m3">newest first</span>
          </header>
          <Suspense fallback={<p className="muted pad">Loading…</p>}>
            <TradesSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>
      </div>

      <div className="cw-lower">
        <section className="panel">
          <header className="ph">
            <h2>How this is priced</h2>
          </header>
          <div className="pad prose-sm">
            <p>
              {c.title} Bid and ask from {venueName}&apos;s market list at {utc(at)}; the order book
              and trades are live.
            </p>
            {c.fairMethod && (
              <p>
                <b>Fair value: {METHODS[c.fairMethod].name}.</b> {METHODS[c.fairMethod].explain}
                {c.bid !== null && c.ask !== null && c.fair !== null && fairUsable && (
                  <>
                    {" "}
                    It is {Math.abs(Math.round((c.fair - (c.bid + c.ask) / 2) * 1000) / 10)}¢{" "}
                    {c.fair > (c.bid + c.ask) / 2 ? "above" : "below"} the midpoint. Not investment
                    advice.
                  </>
                )}
              </p>
            )}
            {tracked && (
              <p>
                Our options-implied fair value for this contract, minute by minute:{" "}
                <Link href={`/c/${c.id}`}>BTC tracker →</Link>
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <header className="ph">
            <h2>Watch and alerts</h2>
          </header>
          <div className="pad">
            <Suspense fallback={null}>
              <Watch venue={venue} id={c.id} />
            </Suspense>
          </div>
        </section>
        <section className="panel cw-rules">
          <header className="ph">
            <h2>Settlement rules</h2>
          </header>
          <div className="pad">
            <Suspense fallback={<p className="muted">Loading…</p>}>
              <RulesSection c={c} />
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}

function Quote({ c }: { c: Row }) {
  const spread = c.bid !== null && c.ask !== null ? c.ask - c.bid : null;
  return (
    <div className="quote num">
      <div>
        <span>Bid</span>
        <b>{cents(c.bid)}</b>
      </div>
      <div>
        <span>Ask</span>
        <b>{cents(c.ask)}</b>
      </div>
      <div>
        <span>Spread</span>
        <b>{cents(spread)}</b>
      </div>
      {c.fair !== null && (
        <div>
          <span>Fair value</span>
          <b className="fair">{cents(c.fair)}</b>
        </div>
      )}
      <div>
        <span>Last trade</span>
        <b>{cents(c.last)}</b>
      </div>
      <div>
        <span>Volume, 24 h</span>
        <b>
          {c.volumeUnit === "usd" ? `$${qty(c.volume)}` : qty(c.volume)}
        </b>
      </div>
      {c.openInterest !== null && (
        <div>
          <span>Open interest</span>
          <b>{qty(c.openInterest)}</b>
        </div>
      )}
    </div>
  );
}
