// One release: each reacting contract's midpoint from 15 minutes before to 30 after, a table of
// the measured figures with their sample sizes, and the method in plain English.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import MoveChart from "@/components/MoveChart";
import {
  byMove,
  cents,
  et,
  getRelease,
  na,
  reacting,
  type Release,
  seconds,
  thinning,
} from "@/lib/events-response";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: event response" };

export default function ReleasePage({ params }: PageProps<"/events/[release]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ReleaseView params={params} />
    </Suspense>
  );
}

const VENUE: Record<string, string> = { kalshi: "Kalshi", polymarket: "Polymarket" };
// A real release moves hundreds of contracts (717 in the 2026-11-23 dry run, 193 by 1¢ or more:
// 6.9 MB of page). Charts for the biggest movers; the table below lists every contract.
const MAX_CHARTS = 24;
const spread = (x: number | null) => na(x, (v) => `${v.toFixed(1)}¢`);

async function ReleaseView({ params }: Pick<PageProps<"/events/[release]">, "params">) {
  await connection(); // request time only: the build never calls the replay server
  const r = await getRelease((await params).release);
  if (!r) notFound();
  const moved = reacting(r.contracts);
  const charted = moved.slice(0, MAX_CHARTS);
  return (
    <div className="wide">
      <p className="crumbs">
        <Link href="/events">Event response</Link>
      </p>
      <h1>
        {r.name}
        {r.standin && (
          <>
            {" "}
            <span className="tag">test run</span>
          </>
        )}
      </h1>
      <p className="muted">
        {r.standin ? "Measured at" : "Released"} {utc(r.t0)} ({et(r.t0)}).{" "}
        {r.standin &&
          "This is not a release: a moment with a known move, used to test the method before the first real one."}
      </p>

      <p className="lead-says">
        <Says r={r} />
      </p>

      <h2>How the contracts moved</h2>
      {charted.length === 0 ? (
        <p className="muted">No contract moved by 1¢ or more.</p>
      ) : (
        <>
          {moved.length > charted.length && (
            <p className="muted small">
              The {charted.length} biggest of {moved.length} contracts that moved 1¢ or more; the table lists them all.
            </p>
          )}
          <div className="response-charts">
            {charted.map((c) => (
              <figure key={`${c.venue}/${c.ticker}`}>
                <figcaption className="small">
                  {VENUE[c.venue] ?? c.venue} <span className="mono">{c.ticker}</span> · {na(c.move_cents, cents)}
                </figcaption>
                <MoveChart mids={c.mids} t0={r.t0} label={c.ticker} />
              </figure>
            ))}
          </div>
        </>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Move</th>
              <th>Time to 90%</th>
              <th>Book within 2¢: 10 min → 30 s before</th>
              <th>Spread at t0 (usual)</th>
              <th>Book changes</th>
            </tr>
          </thead>
          <tbody>
            {byMove(r.contracts).map((c) => (
              <tr key={`${c.venue}/${c.ticker}`}>
                <td>
                  {VENUE[c.venue] ?? c.venue} <span className="mono">{c.ticker}</span>
                </td>
                <td className="num">{na(c.move_cents, cents)}</td>
                <td className="num">{na(c.time_to_90_ms, seconds)}</td>
                <td className="num">{thinning(c.depth_10m_before, c.depth_30s_before)}</td>
                <td className="num">
                  {spread(c.spread_t0_cents)} ({spread(c.spread_usual_cents)})
                </td>
                <td className="num">{c.changes.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="more">
      <summary>How each figure is measured</summary>
      <ul className="muted">
        <li>
          <b>Release time (t0)</b>: the official minute the number is published, from the BLS and
          Fed calendars. The release&apos;s own contracts close a minute before it, so the reaction
          shows in contracts still trading: later Fed meetings, later months&apos; ladders, stock
          index, currency and crypto hourlies.
        </li>
        <li>
          <b>Midpoint</b>: halfway between the best bid (the highest price someone will buy at) and
          the best ask (the lowest price someone will sell at), in cents.
        </li>
        <li>
          <b>Move</b>: the midpoint 30 minutes after t0 minus the midpoint just before t0.
        </li>
        <li>
          <b>Time to 90%</b>: seconds from t0 until the midpoint first gets 90% of the way to where
          it ends up at t0 + 30 min, and stays past that point for 10 seconds, so one stray quote
          doesn&apos;t count.
        </li>
        <li>
          <b>Book thinning</b>: contracts resting within 2¢ of the midpoint, 10 minutes before t0
          against 30 seconds before. Market makers pull quotes before news; this shows by how much.
        </li>
        <li>
          <b>Spread at t0</b>: best ask minus best bid at the moment of release, against its usual
          value (the median from 15 minutes to 1 minute before).
        </li>
        <li>
          <b>Book changes</b>: how many updates to this contract&apos;s order book we saw in the
          window, the sample size behind its figures. &ldquo;n/a&rdquo; means the figure is
          undefined: no book on one side, or no move to time.
        </li>
      </ul>
      <p className="small">
        Clock: our recording machine was {r.clock.vm_offset_us} µs off true time, and timings are
        good to within {r.clock.bound_ms} ms. Time source: {r.clock.time_source}. Polymarket is
        polled every 10 seconds, so its timings are only good to the nearest 10 s. December gives
        three releases: small samples, read them as examples rather than averages.
      </p>
      </details>
    </div>
  );
}

/** The release in one sentence: how many contracts moved, the biggest move and how fast. */
function Says({ r }: { r: Release }) {
  const moved = reacting(r.contracts);
  const top = moved[0];
  if (!top) return <>No contract of the {r.contracts.length} measured moved 1¢ or more.</>;
  return (
    <>
      {moved.length} of {r.contracts.length} contracts still trading moved 1¢ or more. The biggest,{" "}
      {VENUE[top.venue] ?? top.venue} <span className="mono">{top.ticker}</span>, moved{" "}
      <b className="num">{na(top.move_cents, cents)}</b> and got 90% of the way in{" "}
      <b className="num">{na(top.time_to_90_ms, seconds)}</b>. Contracts on its book within 2¢ of the price, 10 minutes before against 30 seconds before:{" "}
      <span className="num">{thinning(top.depth_10m_before, top.depth_30s_before)}</span>.
    </>
  );
}
