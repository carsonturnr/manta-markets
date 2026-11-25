import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import FairLadder from "@/components/FairLadder";
import { cents, cents1, describe, gap, price, utc } from "@/lib/format";
import { getBoard, type Quote } from "@/lib/queries";
import { ladderSummary, outside } from "@/lib/tracker-view";

export const metadata = { title: "Manta: Bitcoin tracker" };

export default function Tracker() {
  return (
    <>
      <h1>Bitcoin fair value against Kalshi</h1>
      <p className="muted">
        Kalshi&apos;s hourly Bitcoin contracts beside Manta&apos;s fair value: the chance that
        Deribit&apos;s Bitcoin options imply for the same question. Updated once a minute; prices
        in cents, the same as a chance in percent.
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
      <p className="fl-key small">
        <span>
          <span className="key fl-key-band" /> Kalshi bid to ask
        </span>
        <span>
          <span className="key fl-key-fair" /> Manta fair value
        </span>
        <span>
          <span className="key fl-key-up" /> fair above the ask: &ldquo;yes&rdquo; looks cheap
          on Kalshi
        </span>
        <span>
          <span className="key fl-key-down" /> fair below the bid: &ldquo;yes&rdquo; looks dear
        </span>
      </p>
      {[...byClose].map(([close, quotes]) => {
        const above = quotes.filter((q) => q.series === "KXBTCD");
        const range = quotes.filter((q) => q.series === "KXBTC");
        return (
          <section key={close} className="panel stack">
            <header className="ph">
              <h2>Closes {utc(close)}</h2>
            </header>
            <div className="pad">
              <p className="fl-says">
                <Says quotes={quotes} />
              </p>
              <div className="fls">
                <FairLadder title="Pays $1 if BTC is above" quotes={above} />
                <FairLadder title="Pays $1 if BTC is in a range" quotes={range} />
              </div>
            </div>
          </section>
        );
      })}
      <details className="more">
        <summary>Show the table</summary>
        {[...byClose].map(([close, quotes]) => (
          <section key={close}>
            <h3>Closes {utc(close)}</h3>
            <QuoteTable title="Above a price" quotes={quotes.filter((q) => q.series === "KXBTCD")} />
            <QuoteTable title="In a range" quotes={quotes.filter((q) => q.series === "KXBTC")} />
          </section>
        ))}
      </details>
      <p className="small">
        <b>Fair value</b>: the chance from Deribit&apos;s options, one labelled tool among
        Manta&apos;s (<Link href="/stats">how accurate it has been</Link>). <b>gap</b> in the
        table: fair minus Kalshi&apos;s mid (halfway between bid and ask), in cents; bold when fair
        is outside Kalshi&apos;s bid–ask. Contracts are listed while either price is between 3¢ and
        97¢; those more than 6 hours from their close update every 5 minutes. No fair value in the
        final 60 seconds, when part of the settlement average is already known.
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

/** One plain sentence on a close: where fair value disagrees with Kalshi by more than its spread. */
function Says({ quotes }: { quotes: Quote[] }) {
  const { above, below, biggest } = ladderSummary(quotes);
  if (!biggest)
    return <>Fair value sits inside Kalshi&apos;s bid–ask on every contract: no gap wider than the spread.</>;
  const by = outside(biggest);
  const n = (k: number) => `${k} contract${k === 1 ? "" : "s"}`;
  return (
    <>
      Fair value is above Kalshi&apos;s ask on {n(above)} and below its bid on {n(below)}. Widest
      gap: <b>{describe(biggest)}</b>, fair <b className="num">{cents1(biggest.fair!)}¢</b> against
      Kalshi <span className="num">{cents(biggest.bid)}–{cents(biggest.ask)}¢</span>,{" "}
      <span className={`num ${by > 0 ? "up" : "down"}`}>{Math.abs(by).toFixed(1)}¢</span>{" "}
      {by > 0 ? "above the ask" : "below the bid"}.
    </>
  );
}

const signed = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(1);
