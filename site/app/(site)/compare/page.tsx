import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { crossed, gap, getPairs, type Pair } from "@/lib/compare";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: cross-venue arbitrage" };

export default function ComparePage() {
  return (
    <>
      <h1>Cross-venue arbitrage</h1>
      <p className="lede">
        The same question on Kalshi and Polymarket. When one venue&apos;s ask is below the
        other&apos;s bid, buying on one and selling on the other locks in the difference, if it
        survives both taker fees. Checked every minute.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Pairs />
      </Suspense>
      <details className="panel pad prose-sm how">
        <summary>How pairs are matched, and what the columns mean</summary>
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
      </details>
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
  // Arbitrage: prices that cross with something left after both legs' taker fees, best first.
  const arbs = pairs
    .flatMap((p) => {
      const x = crossed(p);
      return x && x.net !== null && x.net > 1e-9 ? [{ p, x }] : [];
    })
    .sort((a, b) => b.x.net! - a.x.net!);
  const feesTakeIt = pairs.filter((p) => {
    const x = crossed(p);
    return x !== null && !(x.net !== null && x.net > 1e-9);
  });
  return (
    <>
      <div className="tiles">
        <div className="panel tile">
          <span>Arbitrage after fees</span>
          <b className={arbs.length > 0 ? "up" : undefined}>{arbs.length}</b>
          <small>{crossings} cross before fees</small>
        </div>
        <div className="panel tile">
          <span>Best, per contract</span>
          <b className={arbs.length > 0 ? "up" : undefined}>
            {arbs.length > 0 ? `${arbs[0].x.net!.toFixed(2)}¢` : "–"}
          </b>
          <small>after both taker fees</small>
        </div>
        <div className="panel tile">
          <span>Pairs watched</span>
          <b>{pairs.length}</b>
          <small>in {topics.length} events</small>
        </div>
        <div className="panel tile">
          <span>Prices read</span>
          <b>{at !== null ? utc(at, false) : "–"}</b>
          <small>every minute</small>
        </div>
      </div>

      <h2>Arbitrage now</h2>
      {arbs.length === 0 ? (
        <p className="muted">
          None right now: {crossings === 0 ? "no prices cross." : `${crossings} cross, but fees take it all.`}
        </p>
      ) : (
        <div className="arbs">
          {arbs.map(({ p, x }) => (
            <Arb key={`${p.topic}/${p.question}`} p={p} x={x} />
          ))}
        </div>
      )}
      {feesTakeIt.length > 0 && (
        <p className="small muted">
          {feesTakeIt.length} more cross before fees but not after:{" "}
          {feesTakeIt.map((p) => p.question).join("; ")}.
        </p>
      )}

      <h2>Every pair</h2>
      <p className="small muted">
        Bitcoin and Ether pairs appear only in the hour before noon New York time, the one hour both
        venues list the same moment.
      </p>
      {topics.map((t) => {
        const ps = pairs.filter((p) => p.topic === t);
        const n = ps.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
        // A note every pair in the event shares is said once, under the heading, not on each row.
        const shared = ps.every((p) => p.note === ps[0].note) ? ps[0].note : null;
        return (
          <details key={t} className="panel stack event-pairs">
            <summary className="ph">
              <h3>{t}</h3>
              <span className="m3">
                {ps.length} {ps.length === 1 ? "pair" : "pairs"}
                {n > 0 && <b className="up"> · {n} arbitrage</b>} · Kalshi closes {utc(ps[0].close)}
              </span>
            </summary>
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
          </details>
        );
      })}
    </>
  );
}

const KIND = { same: "Same bet", bundle: "Bundle", near: "Near" } as const;

/** One arbitrage: what to buy and sell where, what's left after fees, and how much of it there is. */
function Arb({ p, x }: { p: Pair; x: NonNullable<ReturnType<typeof crossed>> }) {
  const buy = x.buy === "Kalshi" ? p.kalshi : p.poly;
  const sell = x.buy === "Kalshi" ? p.poly : p.kalshi;
  // As many contracts as both best prices carry: the thinner side limits it.
  const size =
    buy.askSize !== null && sell.bidSize !== null ? Math.floor(Math.min(buy.askSize, sell.bidSize)) : null;
  const link = (venue: "kalshi" | "polymarket", ids: string[], label: string) =>
    ids.length === 1 ? (
      <Link href={`/contract/${venue}/${encodeURIComponent(ids[0])}`}>{label}</Link>
    ) : (
      label
    );
  const venueOf = (name: string) => (name === "Kalshi" ? "kalshi" : "polymarket") as "kalshi" | "polymarket";
  return (
    <article className="panel arb">
      <div className="arb-q">
        <b>{p.question}</b>
        <span className="small muted">
          {p.topic} · {KIND[p.kind]}
          {p.kind !== "same" && p.note && <>: {p.note}</>}
        </span>
      </div>
      <div className="arb-legs num">
        <span>
          Buy yes on {link(venueOf(x.buy), buy.ids, x.buy)} at <b>{cents(buy.ask)}¢</b>
        </span>
        <span>
          Sell yes on {link(venueOf(x.sell), sell.ids, x.sell)} at <b>{cents(sell.bid)}¢</b>
        </span>
      </div>
      <div className="arb-figs num">
        <span>
          <small>Gross</small>
          <b>{x.cents.toFixed(1)}¢</b>
        </span>
        <span>
          <small>After fees</small>
          <b className="up">{x.net!.toFixed(2)}¢</b>
        </span>
        <span>
          <small>Size</small>
          <b>{size !== null ? size.toLocaleString("en-US") : "–"}</b>
        </span>
        <span>
          <small>In all</small>
          <b className="up">{size !== null ? `$${((x.net! * size) / 100).toFixed(2)}` : "–"}</b>
        </span>
      </div>
    </article>
  );
}

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
            Crosses by {x.cents.toFixed(1)}¢
            {x.net === null ? ", fees unknown" : x.net > 1e-9 ? `, ${x.net.toFixed(2)}¢ after fees` : ", fees take it all"}
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
