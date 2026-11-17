import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import ReplayView from "@/components/ReplayView";
import { utc } from "@/lib/format";
import { getPastEvents, getReplay } from "@/lib/replay";

export const metadata = { title: "Manta: replay" };

type Params = Record<string, string | string[] | undefined>;

export default function ReplayPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="wide">
      <h1>Replay</h1>
      <p className="muted">
        A past Bitcoin close on Kalshi, minute by minute: every strike&apos;s best bid and ask, our
        fair value from Deribit&apos;s options, and where Bitcoin settled. Kalshi publishes no
        historical order books; these are rebuilt from our own recordings of its live feed, every
        update applied in order (checked against Kalshi&apos;s own snapshots of the book, with
        no mismatch). Each minute shows the book as it stood just before the minute began.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Replays searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Replays({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const p = await searchParams;
  const e = (Array.isArray(p.e) ? p.e[0] : p.e) ?? "";
  const past = await getPastEvents();
  if (past.length === 0)
    return <p className="muted">No finished replay yet: the first appears an hour or so after a close.</p>;
  const chosen = past.find((x) => x.event === e) ?? past[0];
  const r = await getReplay(chosen.event);
  return (
    <>
      <h2>
        Bitcoin above/below, closing {utc(chosen.close)}
        {chosen.settlement !== null && (
          <span className="muted"> · settled on ${chosen.settlement.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
        )}
      </h2>
      {r === null || r.markets.length === 0 ? (
        <p className="muted">No contract of this close was in play in its last six hours.</p>
      ) : (
        <ReplayView key={r.event} r={r} />
      )}
      <h2>Other closes</h2>
      <p className="small">
        Recorded from 2026-11-17. Fair values and Bitcoin&apos;s price are the tracker&apos;s
        once-a-minute readings. An event listed in the hour before its close starts recording up
        to 10 minutes late: the recorder checks Kalshi&apos;s list of markets every 10 minutes.
      </p>
      <ul className="replay-list">
        {past.map((x) => (
          <li key={x.event}>
            {x.event === chosen.event ? (
              <strong>{utc(x.close)}</strong>
            ) : (
              <Link href={`/replay?e=${encodeURIComponent(x.event)}`}>{utc(x.close)}</Link>
            )}{" "}
            <span className="muted small">{x.event}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
