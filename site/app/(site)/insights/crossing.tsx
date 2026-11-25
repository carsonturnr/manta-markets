// Insights: what crossing between venues really costs after fees. Folded in from the old /compare
// page (2026-11-26): the answer is how many matched questions cross before fees against after, and
// a bar per crossing split into fees and what is left; the full pair tables sit under "More".
import Link from "next/link";
import { connection } from "next/server";
import { arbitrage, crossed, gap, getPairs, type Pair } from "@/lib/compare";
import { utc } from "@/lib/format";

const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}`);
/** Each side's fair value, or one number when they agree to a tenth of a cent. */
function fairs(p: Pair): string {
  const k = p.kalshi.fair;
  const q = p.poly.fair;
  if (k === null && q === null) return "–";
  if (k !== null && q !== null && Math.abs(k - q) < 0.0005) return cents(k);
  return `${cents(k)} / ${cents(q)}`;
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const MAX_BARS = 12;

export default async function Crossing() {
  await connection(); // request time only: the build never queries the database
  const { pairs, at } = await getPairs();
  if (pairs.length === 0) return <p className="muted">No questions are listed on both venues right now.</p>;
  const crossings = pairs.flatMap((p) => {
    const x = crossed(p);
    return x ? [{ p, x }] : [];
  });
  const topics = [...new Set(pairs.map((p) => p.topic))];
  const arbs = arbitrage(pairs);
  const feesTakeIt = crossings.filter(({ x }) => !(x.net !== null && x.net > 1e-9)).map(({ p }) => p);
  const priced = crossings.filter(({ x }) => x.net !== null);
  const gross = median(crossings.map(({ x }) => x.cents));
  const net = median(priced.map(({ x }) => x.net!));
  const bars = [...crossings].sort((a, b) => b.x.cents - a.x.cents).slice(0, MAX_BARS);
  const reach = Math.max(1, ...bars.map(({ x }) => x.cents));
  return (
    <>
      <p className="insight-says">
        Of <b className="num">{pairs.length}</b> questions listed on both Kalshi and Polymarket,{" "}
        <b className="num">{crossings.length}</b> {crossings.length === 1 ? "has" : "have"} prices
        that cross before fees, and <b className={arbs.length > 0 ? "num up" : "num"}>{arbs.length}</b>{" "}
        still {arbs.length === 1 ? "pays" : "pay"} after both venues&apos; fees.
        {gross !== null && (
          <>
            {" "}
            A typical crossing is <b className="num">{gross.toFixed(1)}¢</b> per contract before
            fees{net !== null && <> and <b className="num">{net.toFixed(2)}¢</b> after</>}.
          </>
        )}
      </p>
      <section className="panel stack">
        <header className="ph">
          <h3>Each crossing: fees against what is left</h3>
          <span className="right m3">prices read {at !== null ? utc(at) : "–"}</span>
        </header>
        {bars.length === 0 ? (
          <p className="pad muted">No prices cross right now: every matched question agrees.</p>
        ) : (
          <div className="pad cross-bars">
            {bars.map(({ p, x }) => {
              const kept = x.net === null ? 0 : Math.max(0, x.net);
              const fees = x.net === null ? 0 : x.cents - kept;
              return (
                <div key={`${p.topic}/${p.question}`} className="cross-row">
                  <span className="small">{p.question}</span>
                  <span className="cross-track" title={`${x.cents.toFixed(1)}¢ before fees`}>
                    <span className="cross-fee" style={{ width: `${(fees / reach) * 100}%` }} />
                    <span className="cross-kept" style={{ width: `${(kept / reach) * 100}%` }} />
                    {x.net === null && <span className="cross-unknown" style={{ width: `${(x.cents / reach) * 100}%` }} />}
                  </span>
                  <span className="num small">
                    {x.cents.toFixed(1)}¢ →{" "}
                    {x.net === null ? "fees unknown" : x.net > 1e-9 ? <b className="up">{x.net.toFixed(2)}¢</b> : "0"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <p className="note">
          <b>Crossing</b>: one venue&apos;s ask (the price to buy) sits below the other&apos;s bid
          (the price to sell), so buying on one and selling the same bet on the other locks in the
          gap. Grey: both venues&apos; taker fees; mint: what is left per contract. A snapshot of
          one minute, not a history: the pairs are re-read every minute and only the latest is kept.
        </p>
      </section>
      <details className="more">
        <summary>More: the crossings worth taking, and every matched question</summary>
      <h3>Arbitrage now</h3>
      <p className="small muted terms">
        <b>After fees</b>: what is left per contract once both venues take their trading fee.{" "}
        <b>Size</b>: how many contracts are on offer at both prices; the thinner side limits it.
      </p>
      {arbs.length === 0 ? (
        <p className="muted">
          None right now: {crossings.length === 0 ? "the prices agree." : `${crossings.length} differ, but fees would eat the profit.`}
        </p>
      ) : (
        <div className="arbs">
          {arbs.map((a) => (
            <Arb key={`${a.p.topic}/${a.p.question}`} a={a} />
          ))}
        </div>
      )}
      {feesTakeIt.length > 0 && (
        <p className="small muted">
          {feesTakeIt.length} more {feesTakeIt.length === 1 ? "differs" : "differ"} before fees but not after:{" "}
          {feesTakeIt.map((p) => p.question).join("; ")}.
        </p>
      )}

      <h3>Every matched question</h3>
      <p className="small muted">
        Both venues&apos; prices side by side, grouped by event. Bitcoin and Ether appear only in the
        hour before noon New York time, the one hour both venues list the same moment.
      </p>
      {topics.map((t) => {
        const ps = pairs.filter((p) => p.topic === t);
        const n = ps.filter((p) => (crossed(p)?.net ?? 0) > 1e-9).length;
        // A note every pair in the event shares is said once, under the heading, not on each row.
        const shared = ps.every((p) => p.note === ps[0].note) ? ps[0].note : null;
        return (
          <details key={t} className="panel stack event-pairs">
            <summary className="ph">
              <h4>{t}</h4>
              <span className="m3">
                {ps.length} {ps.length === 1 ? "question" : "questions"}
                {n > 0 && <b className="up"> · {n} worth taking</b>} · Kalshi closes {utc(ps[0].close)}
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
        {/* matching rules and column meanings, from the old page */}
      <details className="panel pad prose-sm how">
        <summary>How questions are matched, and what the table columns mean</summary>
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
      </details>
    </>
  );
}

// How closely the two venues' contracts match, in plain words.
const KIND = {
  same: "Same bet on both venues",
  bundle: "Bundle: several Polymarket ranges bought together match one Kalshi contract",
  near: "Near match",
} as const;

/** One arbitrage: what to buy and sell where, what's left after fees, and how much of it there is. */
function Arb({ a: { p, x, buy, sell, size } }: { a: ReturnType<typeof arbitrage>[number] }) {
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
          {p.kind === "near" && p.note && <>. {p.note}</>}
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
          <small>Price gap</small>
          <b>{x.cents.toFixed(1)}¢</b>
        </span>
        <span>
          <small>After fees</small>
          <b className="up">{x.net.toFixed(2)}¢</b>
        </span>
        <span>
          <small>Size</small>
          <b>{size !== null ? size.toLocaleString("en-US") : "–"}</b>
        </span>
        <span>
          <small>Profit at full size</small>
          <b className="up">{size !== null ? `$${((x.net * size) / 100).toFixed(2)}` : "–"}</b>
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
            {x.cents.toFixed(1)}¢ to buy low and sell high
            {x.net === null ? ", fees unknown" : x.net > 1e-9 ? `, ${x.net.toFixed(2)}¢ after fees` : ", fees eat it all"}
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
