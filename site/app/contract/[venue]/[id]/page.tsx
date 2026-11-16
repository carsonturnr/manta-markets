import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AutoRefresh from "@/components/AutoRefresh";
import PriceChart from "@/components/PriceChart";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getMarket, type Row } from "@/lib/screener";
import { METHODS, SETTLEMENT, summary } from "@/lib/settlement";
import {
  type Book,
  kalshiBook,
  kalshiHistory,
  kalshiRules,
  kalshiTrades,
  polyBook,
  polyHistory,
  polyRules,
  polyTokens,
  polyTrades,
  type Range,
  type Trade,
} from "@/lib/venues";

export const metadata = { title: "Manta: contract" };

const RANGES: Range[] = ["6h", "24h", "7d"];

export default function ContractPage({
  params,
  searchParams,
}: PageProps<"/contract/[venue]/[id]">) {
  return (
    <div className="wide">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Contract params={params} searchParams={searchParams} />
      </Suspense>
    </div>
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
  const range = RANGES.find((r) => r === sp.range) ?? "24h";
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

  return (
    <>
      <AutoRefresh seconds={10} />
      <p className="small">
        <Link href={`/screener?family=${c.family}`}>{family?.name ?? c.family}</Link> · {venueName}{" "}
        · <span className="num">{venue === "kalshi" ? c.id : c.event}</span>
      </p>
      <h1>{summary(c)}</h1>
      <p className="muted">
        {c.title} Closes {utc(c.close)} ({until(c.close, at)}).
        {s && <> Settles on {s.settles}.</>}
      </p>
      <Quote c={c} />
      <p className="small">
        Bid and ask from {venueName}&apos;s market list at {utc(at)}; the order book below is live.
      </p>
      {c.fairMethod && (
        <p className="small">
          <b>Fair value: {METHODS[c.fairMethod].name}.</b> {METHODS[c.fairMethod].explain}
          {c.bid !== null &&
            c.ask !== null &&
            c.fair !== null &&
            c.fairMethod !== "consensus-1" && (
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
        <p className="small">
          Our options-implied fair value for this contract, minute by minute:{" "}
          <Link href={`/c/${c.id}`}>BTC tracker →</Link>
        </p>
      )}

      <h2>Price</h2>
      <p className="pills small">
        {RANGES.map((r) =>
          r === range ? (
            <b key={r}>{r}</b>
          ) : (
            <Link key={r} href={`?range=${r}`} scroll={false}>
              {r}
            </Link>
          ),
        )}
      </p>
      <Suspense fallback={<p className="muted">Loading the chart…</p>}>
        <Chart c={c} range={range} yesToken={tokens?.[0]} />
      </Suspense>

      <div className="columns">
        <section>
          <h2>Order book</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <BookSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>
        <section>
          <h2>Recent trades</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <TradesSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>
      </div>

      <h2>Settlement rules</h2>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <RulesSection c={c} />
      </Suspense>
    </>
  );
}

function Quote({ c }: { c: Row }) {
  const spread = c.bid !== null && c.ask !== null ? c.ask - c.bid : null;
  return (
    <div className="stats">
      <div>
        <span>Bid</span>
        <b className="num">{cents(c.bid)}</b>
      </div>
      <div>
        <span>Ask</span>
        <b className="num">{cents(c.ask)}</b>
      </div>
      <div>
        <span>Spread</span>
        <b className="num">{cents(spread)}</b>
      </div>
      {c.fair !== null && (
        <div>
          <span>Fair value</span>
          <b className="num">{cents(c.fair)}</b>
        </div>
      )}
      <div>
        <span>Last trade</span>
        <b className="num">{cents(c.last)}</b>
      </div>
      <div>
        <span>Volume, 24 h</span>
        <b className="num">
          {c.volumeUnit === "usd" ? `$${qty(c.volume)}` : `${qty(c.volume)} contracts`}
        </b>
      </div>
      {c.openInterest !== null && (
        <div>
          <span>Open interest</span>
          <b className="num">{qty(c.openInterest)}</b>
        </div>
      )}
    </div>
  );
}

const unavailable = (what: string, venue: string) => (
  <p className="muted">
    {what} unavailable right now: {venue === "kalshi" ? "Kalshi" : "Polymarket"} didn&apos;t answer.
  </p>
);

async function Chart({ c, range, yesToken }: { c: Row; range: Range; yesToken?: string }) {
  const points =
    c.venue === "kalshi"
      ? await kalshiHistory(c.family, c.id, range)
      : yesToken
        ? await polyHistory(yesToken, range)
        : null;
  if (!points) return unavailable("Price history", c.venue);
  if (points.length < 2) return <p className="muted">Not enough history in this range yet.</p>;
  return <PriceChart points={points} venue={c.venue} days={range === "7d"} />;
}

async function BookSection({ c, yesToken }: { c: Row; yesToken?: string }) {
  const book: Book | null =
    c.venue === "kalshi" ? await kalshiBook(c.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", c.venue);
  if (book.bids.length === 0 && book.asks.length === 0) {
    return <p className="muted">No orders on either side.</p>;
  }
  const max = Math.max(...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));
  const bar = (size: number) => ({ "--w": `${(size / max) * 100}%` }) as React.CSSProperties;
  return (
    <>
      <div className="table-wrap">
        <table className="book">
          <thead>
            <tr>
              <th>Price</th>
              <th>Contracts</th>
            </tr>
          </thead>
          <tbody>
            {[...book.asks].reverse().map((l) => (
              <tr key={`a${l.price}`} className="ask">
                <td className="num">Ask {cents(l.price)}</td>
                <td className="num level" style={bar(l.size)}>
                  {qty(l.size)}
                </td>
              </tr>
            ))}
            <tr className="mid">
              <td colSpan={2} className="small">
                spread{" "}
                {book.bids[0] && book.asks[0]
                  ? cents(book.asks[0].price - book.bids[0].price)
                  : "–"}
              </td>
            </tr>
            {book.bids.map((l) => (
              <tr key={`b${l.price}`} className="bid">
                <td className="num">Bid {cents(l.price)}</td>
                <td className="num level" style={bar(l.size)}>
                  {qty(l.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        The best {book.asks.length} asks and {book.bids.length} bids for &ldquo;yes&rdquo;, live
        within seconds.
        {c.venue === "kalshi" &&
          " Kalshi lists bids for “yes” and for “no”; a “no” bid at 26¢ is shown as a “yes” ask at 74¢."}
      </p>
    </>
  );
}

async function TradesSection({ c, yesToken }: { c: Row; yesToken?: string }) {
  const trades: Trade[] | null =
    c.venue === "kalshi"
      ? await kalshiTrades(c.id)
      : yesToken
        ? await polyTrades(c.id, yesToken)
        : null;
  if (!trades) return unavailable("Trades", c.venue);
  if (trades.length === 0) return <p className="muted">No trades yet.</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th style={{ textAlign: "left" }}>Side</th>
              <th>Price</th>
              <th>Contracts</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={`${t.t}/${i}`}>
                <td className="num">
                  {new Date(t.t).toISOString().slice(5, 19).replace("T", " ")}
                </td>
                <td style={{ textAlign: "left" }}>{t.side === "buy" ? "buy yes" : "sell yes"}</td>
                <td className="num">{cents(t.price)}</td>
                <td className="num">{qty(t.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        {c.venue === "kalshi"
          ? "The side is the trader who crossed the spread: “buy yes” took an ask."
          : "The side is as Polymarket's trade feed reports it. Trades in the “no” token are shown in “yes” terms."}
      </p>
    </>
  );
}

async function RulesSection({ c }: { c: Row }) {
  const rules = c.venue === "kalshi" ? await kalshiRules(c.id) : await polyRules(c.event);
  if (!rules) return unavailable("The rules", c.venue);
  return (
    <blockquote className="rules">
      {rules.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <footer className="small">— {rules.source}</footer>
    </blockquote>
  );
}
