import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { cents, cents1, describe, gap, price, utc } from "@/lib/format";
import { getBoard, type Quote } from "@/lib/queries";

export const metadata = { title: "Manta: Bitcoin tracker" };

export default function Tracker() {
  return (
    <>
      <h1>Kalshi vs the options market</h1>
      <p className="muted">
        Kalshi sells yes/no contracts on Bitcoin&apos;s price at the top of each hour. Deribit&apos;s
        options imply a probability for the same question. This page puts the two side by side,
        once a minute. Prices are in cents, which is the same as a probability in percent.
      </p>
      <Suspense fallback={<p className="muted">Loading the latest snapshot…</p>}>
        <Live />
      </Suspense>
    </>
  );
}

async function Live() {
  await connection(); // request time only: the build never queries the database
  const board = await getBoard();
  if (!board) return <p>No snapshots yet.</p>;
  // Older than 5 minutes means the snapshotter has stopped: say so rather than show stale prices
  // as current.
  const ageMin = board.ageS / 60;

  const byClose = new Map<number, Quote[]>();
  for (const q of board.quotes) byClose.set(q.close, [...(byClose.get(q.close) ?? []), q]);

  return (
    <>
      <div className="stats">
        <div>
          <span>BTC index (Deribit)</span>
          <b className="num">{price(board.index)}</b>
        </div>
        {board.coinbase && (
          <div>
            <span>Coinbase BTC/USD</span>
            <b className="num">{price(board.coinbase)}</b>
          </div>
        )}
        <div>
          <span>Snapshot</span>
          <b className="num">{utc(board.at, false).replace(" UTC", "")}</b> UTC
        </div>
      </div>
      {ageMin > 5 && (
        <p className="warn">
          The latest snapshot is {Math.round(ageMin)} minutes old: the snapshotter isn&apos;t
          running right now, so these prices are not current.
        </p>
      )}
      {[...byClose].map(([close, quotes]) => (
        <section key={close}>
          <h2>Closes {utc(close)}</h2>
          <QuoteTable title="Above a price" quotes={quotes.filter((q) => q.series === "KXBTCD")} />
          <QuoteTable title="In a range" quotes={quotes.filter((q) => q.series === "KXBTC")} />
        </section>
      ))}
      <p className="small">
        <b>fair</b>: our probability from Deribit&apos;s options. <b>gap</b>: fair minus
        Kalshi&apos;s mid (halfway between bid and ask), in cents; bold when fair is outside
        Kalshi&apos;s bid–ask, the case a trader could act on. Contracts are listed while either
        price is between 3¢ and 97¢; those more than 6 hours from their close update every 5
        minutes. No fair value in the final 60 seconds, when part of the
        settlement average is already known.
      </p>
    </>
  );
}

function QuoteTable({ title, quotes }: { title: string; quotes: Quote[] }) {
  if (quotes.length === 0) return null;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{title}: pays $1 if BTC is</th>
              <th>Kalshi bid</th>
              <th>ask</th>
              <th>fair</th>
              <th>gap</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => {
              const outside = q.fair !== null && (q.fair < q.bid || q.fair > q.ask);
              return (
                <tr key={q.ticker}>
                  <td>
                    <Link href={`/c/${q.ticker}`}>{describe(q)}</Link>
                  </td>
                  <td className="num">{cents(q.bid)}</td>
                  <td className="num">{cents(q.ask)}</td>
                  <td className="num">{q.fair === null ? "–" : cents1(q.fair)}</td>
                  <td className={`num${outside ? " outside" : ""}`}>
                    {q.fair === null ? "in final 60 s" : signed(gap(q.fair, q.bid, q.ask))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const signed = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1);
