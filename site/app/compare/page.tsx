import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPairs, type Pair, type Side } from "@/lib/compare";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: cross-venue" };

export default function ComparePage() {
  return (
    <div className="wide">
      <h1>Cross-venue</h1>
      <p className="muted">
        The same event on Kalshi and Polymarket, side by side. Pairs come from fixed rules per
        contract family, never from matching text, and each says how equivalent its two sides are.
        Prices are for &ldquo;yes&rdquo;, in cents; refreshed every minute from each venue&apos;s
        market list. Fees are not included.
      </p>
      <ul className="small kinds">
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
          <b>Gap</b>: Kalshi&apos;s midpoint minus Polymarket&apos;s, in cents. For a bundle, whose
          midpoint is skewed by its buckets&apos; combined spread, it is how far Kalshi&apos;s
          midpoint lies outside the bundle&apos;s bid–ask range, or &ldquo;inside&rdquo;.
        </li>
      </ul>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Pairs />
      </Suspense>
    </div>
  );
}

const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}`);
const mid = (s: Side) => (s.bid !== null && s.ask !== null ? (s.bid + s.ask) / 2 : null);

/** How far apart the venues are, in cents. A single contract against a single contract: the
 * difference of their midpoints. Against a bundle, whose midpoint is skewed by its buckets'
 * combined spread: how far Kalshi's midpoint lies outside the bundle's bid–ask range, 0 inside. */
function gap(p: Pair): { cents: number; inside: boolean } | null {
  const km = mid(p.kalshi);
  if (km === null) return null;
  if (p.kind !== "bundle") {
    const qm = mid(p.poly);
    return qm === null ? null : { cents: (km - qm) * 100, inside: false };
  }
  const { bid, ask } = p.poly;
  if (bid === null || ask === null) return null;
  if (km >= bid && km <= ask) return { cents: 0, inside: true };
  return { cents: (km < bid ? km - bid : km - ask) * 100, inside: false };
}

/** If one venue's ask is below the other's bid, buying there and selling on the other locks in
 * the gap, before fees: how many cents, and which way. */
function crossed(p: Pair): { cents: number; buy: string; sell: string } | null {
  const k = p.kalshi;
  const q = p.poly;
  if (k.ask !== null && q.bid !== null && q.bid - k.ask > 1e-9) {
    return { cents: (q.bid - k.ask) * 100, buy: "Kalshi", sell: "Polymarket" };
  }
  if (q.ask !== null && k.bid !== null && k.bid - q.ask > 1e-9) {
    return { cents: (k.bid - q.ask) * 100, buy: "Polymarket", sell: "Kalshi" };
  }
  return null;
}

async function Pairs() {
  await connection(); // request time only: the build never queries the database
  const { pairs, at } = await getPairs();
  if (pairs.length === 0) return <p className="muted">No pairs right now.</p>;
  const topics = [...new Set(pairs.map((p) => p.topic))];
  const crossings = pairs.filter((p) => crossed(p) !== null).length;
  return (
    <>
      <p className="small">
        {pairs.length} pairs in {topics.length} events
        {at !== null && <> · listing read {utc(at)}</>} · {crossings} with prices that cross (before
        fees). Bitcoin and Ether pairs appear only in the hour before noon New York time, the one
        hour both venues list the same moment.
      </p>
      {topics.map((t) => {
        const ps = pairs.filter((p) => p.topic === t);
        return (
          <section key={t}>
            <h2>{t}</h2>
            <p className="small">Kalshi closes {utc(ps[0].close)}.</p>
            <div className="table-wrap">
              <table className="compare">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Kalshi bid / ask</th>
                    <th>Polymarket bid / ask</th>
                    <th title="Kalshi's midpoint minus Polymarket's, in cents; for a bundle, how far Kalshi's midpoint lies outside the bundle's bid–ask range">
                      Gap
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => (
                    <PairRow key={p.question} p={p} />
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

function PairRow({ p }: { p: Pair }) {
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
          {p.note && <> · {p.note}</>}
        </span>
        {x && (
          <span className="small status-bad">
            Prices cross by {x.cents.toFixed(1)}¢: buy on {x.buy}, sell on {x.sell}, before fees.
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
      <td className="num">
        {g === null ? "–" : g.inside ? "inside" : `${g.cents > 0 ? "+" : ""}${g.cents.toFixed(1)}`}
      </td>
    </tr>
  );
}
