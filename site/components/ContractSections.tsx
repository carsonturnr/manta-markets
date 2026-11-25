// The live parts of a contract, shared by the contract page and the event page: its price chart,
// order book, cost calculator, trades and rules, the AI brief and the link out to the venue. Server
// components: each fetches its own data (lib/venues.ts, cached briefly) inside Suspense boundaries.
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import AlertForm from "@/components/AlertForm";
import CandleChart from "@/components/CandleChart";
import { getAlerts, isPaired, isWatched } from "@/lib/account";
import { deleteAlert, toggleWatch } from "@/lib/accountActions";
import { describe } from "@/lib/alerts";
import CostCalc from "@/components/CostCalc";
import { getBrief } from "@/lib/brief-api";
import { getContract } from "@/lib/queries";
import type { Row } from "@/lib/screener";
import {
  type Book,
  kalshiBook,
  kalshiCandles,
  kalshiRules,
  kalshiTrades,
  polyBook,
  polyCandles,
  polyRules,
  polyTrades,
  type Trade,
} from "@/lib/venues";

/** Cents with at most one decimal: 0.42 → "42¢", 0.918 → "91.8¢". */
const cents = (p: number | null | undefined) =>
  p === null || p === undefined ? "–" : `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

export const unavailable = (what: string, venue: string) => (
  <p className="muted">
    {what} unavailable right now: {venue === "kalshi" ? "Kalshi" : "Polymarket"} didn&apos;t answer.
  </p>
);

export async function Chart({ c, yesToken, tracked }: { c: Row; yesToken?: string; tracked: boolean }) {
  // Both resolutions at once, so switching timeframe on the chart needs no new request.
  if (c.venue === "kalshi") {
    const [m1, h1, ours] = await Promise.all([
      kalshiCandles(c.family, c.id, "1m"),
      kalshiCandles(c.family, c.id, "1h"),
      tracked ? getContract(c.id) : null, // our fair value, recorded once a minute
    ]);
    if (!m1 || !h1) return unavailable("Price history", c.venue);
    const fair = ours?.points.flatMap((p) => (p.fair === null ? [] : [{ t: p.t, fair: p.fair }]));
    return <CandleChart kalshi={{ m1, h1 }} fair={fair} />;
  }
  if (!yesToken) return unavailable("Price history", c.venue);
  const [m1, h1] = await Promise.all([polyCandles(yesToken, "1m"), polyCandles(yesToken, "1h")]);
  if (!m1 || !h1) return unavailable("Price history", c.venue);
  return <CandleChart poly={{ m1, h1 }} />;
}

export async function BookSection({
  c,
  yesToken,
  levels = 12,
}: {
  c: Row;
  yesToken?: string;
  levels?: number;
}) {
  const book: Book | null =
    c.venue === "kalshi" ? await kalshiBook(c.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", c.venue);
  if (book.bids.length === 0 && book.asks.length === 0) {
    return <p className="muted">No orders on either side.</p>;
  }
  // The best `levels` each side are shown; the calculator walks all of them (up to 50). One row per
  // rank, like a stock's depth-of-market: bids on the left, asks on the right, best prices on top.
  const bids = book.bids.slice(0, levels);
  const asks = book.asks.slice(0, levels);
  const max = Math.max(...bids.map((l) => l.size), ...asks.map((l) => l.size));
  const bar = (size: number) => ({ "--w": `${(size / max) * 100}%` }) as React.CSSProperties;
  // Running totals: how many contracts are on offer at this price or better.
  const total = (ls: typeof bids) => ls.map((_, i) => ls.slice(0, i + 1).reduce((s, l) => s + l.size, 0));
  const bidTotals = total(bids);
  const askTotals = total(asks);
  const mid = book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : null;
  const ranks = Array.from({ length: Math.max(bids.length, asks.length) }, (_, i) => i);
  return (
    <>
      <p className="dom-line num">
        spread{" "}
        {book.bids[0] && book.asks[0] ? cents(book.asks[0].price - book.bids[0].price) : "–"}
        {mid !== null && <> · mid {cents(mid)}</>}
        {c.fair !== null && <> · fair {cents(c.fair)}</>}
      </p>
      <div className="table-wrap scroll">
        <table className="dom num">
          <thead>
            <tr>
              <th className="dom-total">Total</th>
              <th>Contracts</th>
              <th>Bid</th>
              <th>Ask</th>
              <th>Contracts</th>
              <th className="dom-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranks.map((i) => {
              const b = bids[i];
              const a = asks[i];
              return (
                <tr key={i}>
                  <td className="dom-total m3">{b ? qty(bidTotals[i]) : ""}</td>
                  <td className="dom-bid-size" style={b ? bar(b.size) : undefined}>
                    {b ? qty(b.size) : ""}
                  </td>
                  <td className="up">{b ? cents(b.price) : ""}</td>
                  <td className="down">{a ? cents(a.price) : ""}</td>
                  <td className="dom-ask-size" style={a ? bar(a.size) : undefined}>
                    {a ? qty(a.size) : ""}
                  </td>
                  <td className="dom-total m3">{a ? qty(askTotals[i]) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Bids are offers to buy &ldquo;yes&rdquo;, asks are offers to sell it; the spread is the gap
        between the best of each. Total counts the contracts at that price or better.
        {c.venue === "kalshi" &&
          " Kalshi lists bids for “yes” and for “no”; a “no” bid at 26¢ is shown as a “yes” ask at 74¢."}
        {levels < 12 && (
          <>
            {" "}
            <Link href={`/contract/${c.venue}/${encodeURIComponent(c.id)}`}>Full book</Link>.
          </>
        )}
      </p>
    </>
  );
}

/** The venue's own page for this contract's event, where it can be traded (Manta places no
 * orders). Checked 2026-11-25: kalshi.com/markets/<series>/<event> redirects to the event's page;
 * polymarket.com/event/<slug> is the event's page. */
export function TradeLink({ c }: { c: Pick<Row, "venue" | "family" | "event"> }) {
  const href =
    c.venue === "kalshi"
      ? `https://kalshi.com/markets/${c.family.toLowerCase()}/${c.event.toLowerCase()}`
      : `https://polymarket.com/event/${encodeURIComponent(c.event)}`;
  return (
    <a className="trade-link" href={href} target="_blank" rel="noopener noreferrer">
      Trade on {c.venue === "kalshi" ? "Kalshi" : "Polymarket"} →
    </a>
  );
}

/** The AI summary of Manta's data on this contract (lib/brief-api.ts). Renders nothing when the
 * key is missing or the call fails. */
export async function MarketBrief({ c }: { c: Pick<Row, "venue" | "id"> }) {
  const bullets = await getBrief(c.venue, c.id);
  if (!bullets) return null;
  return (
    <section className="brief">
      <h2>Market brief</h2>
      <ul>
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <p className="note">AI summary of Manta&apos;s data. Not investment advice.</p>
    </section>
  );
}

export async function CostSection({
  c,
  yesToken,
  side,
  n,
  fairUsable,
}: {
  c: Row;
  yesToken?: string;
  side: "buy" | "sell";
  n: number;
  fairUsable: boolean;
}) {
  const book: Book | null =
    c.venue === "kalshi" ? await kalshiBook(c.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", c.venue);
  return (
    <CostCalc
      venue={c.venue}
      book={book}
      rate={c.feeTaker}
      makerRate={c.feeMaker}
      fair={fairUsable ? c.fair : null}
      side={side}
      n={n}
    />
  );
}

export async function TradesSection({ c, yesToken }: { c: Row; yesToken?: string }) {
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
      <div className="table-wrap scroll">
        <table className="tape num">
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
                <td className="m2">{new Date(t.t).toISOString().slice(5, 19).replace("T", " ")}</td>
                <td style={{ textAlign: "left" }} className={t.side === "buy" ? "up" : "down"}>
                  {t.side === "buy" ? "buy yes" : "sell yes"}
                </td>
                <td>{cents(t.price)}</td>
                <td>{qty(t.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {c.venue === "kalshi"
          ? "The side is the trader who crossed the spread: “buy yes” took an ask."
          : "The side is as Polymarket's trade feed reports it. Trades in the “no” token are shown in “yes” terms."}
      </p>
    </>
  );
}

export async function RulesSection({ c }: { c: Row }) {
  const rules = c.venue === "kalshi" ? await kalshiRules(c.id) : await polyRules(c.event);
  if (!rules) return unavailable("The rules", c.venue);
  return (
    <div className="rules">
      {/* The venue's own words, unedited: said once, up front. */}
      {rules.paragraphs.map((p, i) => (
        <p key={i}>
          {i === 0 && <b>From {c.venue === "kalshi" ? "Kalshi" : "Polymarket"}: </b>}
          {p}
        </p>
      ))}
    </div>
  );
}

/** Watch and alerts for the signed-in user (lib/account.ts); a sign-in prompt otherwise. */
export async function Watch({ venue, id }: { venue: string; id: string }) {
  const { userId } = await auth();
  if (!userId) {
    return (
      <p className="small">
        <SignInButton mode="modal">
          <button type="button" className="link-button">
            Sign in
          </button>
        </SignInButton>{" "}
        to watch this contract or get an email alert when it moves.
      </p>
    );
  }
  const [watched, alerts, paired] = await Promise.all([
    isWatched(userId, venue, id),
    getAlerts(userId, venue, id),
    isPaired(venue, id),
  ]);
  return (
    <section className="watch">
      <form action={toggleWatch.bind(null, venue, id)}>
        <button type="submit">{watched ? "★ Watching" : "☆ Watch"}</button>{" "}
        <Link href="/account" className="small">
          Your watchlist and alerts
        </Link>
      </form>
      {alerts.length > 0 && (
        <ul className="alert-list small">
          {alerts.map((a) => (
            <li key={a.alertId}>
              {describe(a.kind, a.threshold)}
              {a.met && <b> · met now</b>}
              <form action={deleteAlert.bind(null, a.alertId)}>
                <button type="submit" className="link-button" aria-label="Delete this alert">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AlertForm venue={venue} id={id} paired={paired} />
    </section>
  );
}
