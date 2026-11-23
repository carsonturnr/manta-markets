"use client";
// The terminal's live panels, all drawn from one 2-second feed (Live.tsx): the order book with
// its depth chart and liquidity figures, the trade tape with large trades flagged, and the ticket.
import BuyBox from "@/components/BuyBox";
import { bookMid, cumulative, depthNear, imbalance } from "@/lib/book";
import type { Level } from "@/lib/cost";
import { useEffect, useRef } from "react";
import { useLive } from "./Live";

const c = (p: number) => `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) =>
  n >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
const usd = (x: number) =>
  x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** "updated 1 s ago", or a warning when the feed has failed. */
function Fresh() {
  const { at, error } = useLive();
  if (error) return <span className="t-stale">feed interrupted, showing last data</span>;
  return <span className="t-live">{at ? "live · every 2 s" : "loading"}</span>;
}

/** The order book: asks above, bids below, a bar for each level's size, the spread between. */
export function BookPanel({ fair }: { fair: number | null }) {
  const { book } = useLive();
  const mid = useRef<HTMLTableRowElement>(null);
  const loaded = book !== null;
  // Asks sit above the spread, so a short panel would show only the far asks: centre the spread
  // once when the book arrives, then leave the scroll to the reader.
  useEffect(() => {
    const r = mid.current;
    const body = r?.closest(".t-body");
    if (!r || !body) return;
    const a = r.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    body.scrollTop += a.top - b.top - (b.height - a.height) / 2;
  }, [loaded]);
  if (!book) return <p className="t-empty">Loading the book…</p>;
  const asks = book.asks.slice(0, 12);
  const bids = book.bids.slice(0, 12);
  const max = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size));
  const askTot = cumulative(asks);
  const bidTot = cumulative(bids);
  const row = (l: Level, total: number, side: "ask" | "bid") => (
    <tr key={`${side}${l.price}`} className={side}>
      <td>{c(l.price)}</td>
      <td className="lvl" style={{ "--w": `${(l.size / max) * 100}%` } as React.CSSProperties}>
        {qty(l.size)}
      </td>
      <td className="t-dim">{qty(total)}</td>
    </tr>
  );
  const m = bookMid(book);
  const spread = book.bids[0] && book.asks[0] ? book.asks[0].price - book.bids[0].price : null;
  return (
    <>
      <div className="t-sub">
        <Fresh />
      </div>
      <table className="t-book num">
        <thead>
          <tr>
            <th>Price</th>
            <th>Size</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {asks.map((l, i) => row(l, askTot[i].total, "ask")).reverse()}
          <tr className="t-spread" ref={mid}>
            <td colSpan={3}>
              {spread !== null ? `spread ${c(spread)}` : "one-sided"}
              {m !== null && ` · mid ${c(m)}`}
              {fair !== null && (
                <>
                  {" · "}
                  <span className="t-mint">fair {c(fair)}</span>
                </>
              )}
            </td>
          </tr>
          {bids.map((l, i) => row(l, bidTot[i].total, "bid"))}
        </tbody>
      </table>
    </>
  );
}

/** Depth chart: contracts available at each price or better, bids left of the mid, asks right. */
export function DepthPanel() {
  const { book } = useLive();
  if (!book || (!book.bids.length && !book.asks.length)) return <p className="t-empty">No book yet.</p>;
  const W = 340;
  const H = 150;
  const bids = cumulative(book.bids);
  const asks = cumulative(book.asks);
  const lo = bids.at(-1)?.price ?? asks[0].price;
  const hi = asks.at(-1)?.price ?? bids[0].price;
  const top = Math.max(1, bids.at(-1)?.total ?? 0, asks.at(-1)?.total ?? 0);
  const x = (p: number) => ((p - lo) / Math.max(hi - lo, 0.01)) * W;
  const y = (t: number) => H - (t / top) * (H - 8);
  // A step line from the best price outwards, closed down to the axis.
  const steps = (pts: { price: number; total: number }[]) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.price)},${y(i ? pts[i - 1].total : 0)}L${x(p.price)},${y(p.total)}`).join("") +
    (pts.length ? `L${x(pts.at(-1)!.price)},${H}L${x(pts[0].price)},${H}Z` : "");
  const near = depthNear(book, 0.05);
  const imb = imbalance(book, 0.05);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="t-depth" preserveAspectRatio="none" aria-label="Depth chart">
        <path d={steps(bids)} className="bid" />
        <path d={steps(asks)} className="ask" />
      </svg>
      <div className="t-liq num">
        <div>
          <span>Bids within 5¢</span>
          <b className="up">{usd(near.bid)}</b>
        </div>
        <div>
          <span>Asks within 5¢</span>
          <b className="down">{usd(near.ask)}</b>
        </div>
        <div>
          <span>Imbalance</span>
          <b className={imb > 0.1 ? "up" : imb < -0.1 ? "down" : ""}>
            {imb > 0 ? "+" : imb < 0 ? "−" : ""}
            {Math.abs(Math.round(imb * 100))}%
          </b>
        </div>
      </div>
      <div className="t-imb" aria-hidden="true">
        <i style={{ width: `${((imb + 1) / 2) * 100}%` }} />
      </div>
    </>
  );
}

/** Large trades: $250 or more changing hands in one print. */
const LARGE = 250;

/** Time and sales, newest first; large prints highlighted; buy and sell dollars over the window. */
export function TapePanel() {
  const { trades } = useLive();
  if (!trades) return <p className="t-empty">Loading trades…</p>;
  if (!trades.length) return <p className="t-empty">No trades yet.</p>;
  const notional = (t: { price: number; size: number }) => t.price * t.size;
  const buys = trades.filter((t) => t.side === "buy").reduce((s, t) => s + notional(t), 0);
  const sells = trades.filter((t) => t.side === "sell").reduce((s, t) => s + notional(t), 0);
  return (
    <>
      <div className="t-sub num">
        <span>
          Last {trades.length}: <b className="up">{usd(buys)} bought</b> ·{" "}
          <b className="down">{usd(sells)} sold</b>
        </span>
      </div>
      <table className="t-tape num">
        <tbody>
          {trades.map((t, i) => (
            <tr key={`${t.t}/${i}`} className={notional(t) >= LARGE ? "large" : undefined}>
              <td className="t-dim">{new Date(t.t).toISOString().slice(11, 19)}</td>
              <td className={t.side === "buy" ? "up" : "down"}>{t.side === "buy" ? "Buy" : "Sell"}</td>
              <td>{c(t.price)}</td>
              <td>{qty(t.size)}</td>
              <td className="t-dim">{usd(notional(t))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The ticket: what a dollar amount buys on the live book, fees included. Nothing is ordered. */
export function TicketPanel({
  venue,
  rate,
}: {
  venue: "kalshi" | "polymarket";
  rate: number | null;
}) {
  const { book } = useLive();
  if (!book) return <p className="t-empty">Loading the book…</p>;
  return <BuyBox venue={venue} book={book} rate={rate} />;
}
