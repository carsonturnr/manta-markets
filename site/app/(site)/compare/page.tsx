import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { crossed, gap, getPairs, type Pair } from "@/lib/compare";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: cross-venue" };

export default function ComparePage() {
  return (
    <>
      <h1>Cross-venue</h1>
      <p>
        The same event on Kalshi and Polymarket, side by side. Pairs come from fixed rules per
        contract family, never from matching text, and each says how equivalent its two sides are.
        Prices are for &ldquo;yes&rdquo;, in cents; refreshed every minute from each venue&apos;s
        market list. Crossing prices are checked after both legs&apos; taker fees.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Pairs />
      </Suspense>
      <h2>How to read this</h2>
      <section className="panel pad prose-sm">
      <ul className="kinds">
        <li>
          <b>Same bet</b>: the identical outcome, settled on the same source (the Fed&apos;s
          decision).
        </li>
        <li>
          <b>Bundle</b>: Kalshi asks &ldquo;above x?&rdquo;; Polymarket sells one contract per
          value. Buying every Polymarket bucket above x pays $1 exactly when Kalshi&apos;s contract
          does, so the bundle&apos;s ask is the sum of their asks, its bid the sum of their bids,
          and its size the thinnest bucket&apos;s. A bundle with many thin buckets can cost more
          than $1: never worth buying, but an honest price.
        </li>
        <li>
          <b>Near</b>: equivalent except in the case stated under it.
        </li>
        <li>
          <b>Fair</b>: our fair value (as on the screener). Economics pairs share one consensus
          curve, so both sides get the same number. Bitcoin and Ether are priced from options on
          what each venue settles on: Kalshi on an index averaged over 60 seconds, Polymarket on
          Binance&apos;s price, which trades about 0.1% above the index. Two numbers there are the
          settlement difference, measured.
        </li>
        <li>
          <b>Gap</b>: Kalshi&apos;s midpoint minus Polymarket&apos;s, in cents. For a bundle, whose
          midpoint is skewed by its buckets&apos; combined spread, it is how far Kalshi&apos;s
          midpoint lies outside the bundle&apos;s bid–ask range, or &ldquo;inside&rdquo;.
        </li>
      </ul>
      </section>
    </>
  );
}

const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}`);
/** Each side's fair value, or one number when they agree to a tenth of a cent. */
function fairs(p: Pair): string {
  const k = p.kalshi.fair;
  const q = p.poly.fair;
  if (k === null && q === null) return "–";
  if (k !== null && q !== null && Math.abs(k - q) < 0.0005) return cents(k);
  return `${cents(k)} / ${cents(q)}`;
}

async function Pairs() {
  await connection(); // request time only: the build never queries the database
  const { pairs, at } = await getPairs();
  if (pairs.length === 0) return <p className="muted">No pairs right now.</p>;
  const topics = [...new Set(pairs.map((p) => p.topic))];
  const crossings = pairs.filter((p) => crossed(p) !== null).length;
  const afterFees = pairs.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
  return (
    <>
      <div className="tiles">
        <div className="panel tile">
          <span>Pairs</span>
          <b>{pairs.length}</b>
          <small>in {topics.length} events</small>
        </div>
        <div className="panel tile">
          <span>Prices cross before fees</span>
          <b>{crossings}</b>
          <small>one venue&apos;s ask below the other&apos;s bid</small>
        </div>
        <div className="panel tile">
          <span>Still cross after fees</span>
          <b className={afterFees > 0 ? "up" : undefined}>{afterFees}</b>
          <small>after both legs&apos; taker fees</small>
        </div>
        <div className="panel tile">
          <span>Listing read</span>
          <b>{at !== null ? utc(at, false) : "–"}</b>
          <small>refreshed every minute</small>
        </div>
      </div>
      <p className="small">
        Bitcoin and Ether pairs appear only in the hour before noon New York time, the one hour
        both venues list the same moment.
      </p>
      {/* A long page (one table per event): jump straight to one. */}
      <nav className="jump" aria-label="Events on this page">
        {topics.map((t) => (
          <a key={t} href={`#${anchor(t)}`}>
            {t}
          </a>
        ))}
      </nav>
      {topics.map((t) => {
        const ps = pairs.filter((p) => p.topic === t);
        // A note every pair in the event shares is said once, under the heading, not on each row.
        const shared = ps.every((p) => p.note === ps[0].note) ? ps[0].note : null;
        return (
          <section key={t} id={anchor(t)} className="panel stack">
            <header className="ph">
              <h2>{t}</h2>
              <span className="right m3">Kalshi closes {utc(ps[0].close)}</span>
            </header>
            {shared && <p className="small pad-x shared-note">{shared}</p>}
            <div className="table-wrap">
              <table className="compare">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Kalshi bid / ask</th>
                    <th>Polymarket bid / ask</th>
                    <th title="Our fair value for each side; one number when both come from the same consensus curve">
                      Fair
                    </th>
                    <th title="Kalshi's midpoint minus Polymarket's, in cents; for a bundle, how far Kalshi's midpoint lies outside the bundle's bid–ask range">
                      Gap
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => (
                    <PairRow key={p.question} p={p} showNote={!shared} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

const anchor = (topic: string) => topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function PairRow({ p, showNote }: { p: Pair; showNote: boolean }) {
  const g = gap(p);
  const x = crossed(p);
  const bundle = p.kind === "bundle" || p.poly.ids.length > 1;
  return (
    <tr>
      <td className="contract">
        <span>{p.question}</span>
        <span className="small">
          {p.kind === "same" ? "Same bet" : p.kind === "bundle" ? "Bundle" : "Near"}
          {bundle && <> of {p.poly.labels.join(", ")}</>}
          {showNote && p.note && <> · {p.note}</>}
        </span>
        {x && (
          <span className={x.net !== null && x.net > 1e-9 ? "small status-bad" : "small"}>
            Prices cross by {x.cents.toFixed(1)}¢: buy on {x.buy}, sell on {x.sell}.{" "}
            {x.net === null
              ? "Fees unknown."
              : x.net > 1e-9
                ? `${x.net.toFixed(2)}¢ a contract left after both taker fees, up to the best prices' size.`
                : `Fees take it all: ${x.net.toFixed(2)}¢ a contract after both taker fees.`}
          </span>
        )}
      </td>
      <td className="num">
        <Link href={`/contract/kalshi/${encodeURIComponent(p.kalshi.ids[0])}`}>
          {cents(p.kalshi.bid)} / {cents(p.kalshi.ask)}
        </Link>
      </td>
      <td className="num">
        {bundle ? (
          <>
            {cents(p.poly.bid)} / {cents(p.poly.ask)}
          </>
        ) : (
          <Link href={`/contract/polymarket/${p.poly.ids[0]}`}>
            {cents(p.poly.bid)} / {cents(p.poly.ask)}
          </Link>
        )}
      </td>
      <td className="num">{fairs(p)}</td>
      <td className="num">
        {g === null ? "–" : g.inside ? "inside" : `${g.cents > 0 ? "+" : ""}${g.cents.toFixed(1)}`}
      </td>
    </tr>
  );
}
