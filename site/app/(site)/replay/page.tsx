import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import ReplayView from "@/components/ReplayView";
import { utc } from "@/lib/format";
import { fmtValue } from "@/lib/units";
import { familyName, getPastEvents, getReplay, REPLAY_FAMILIES } from "@/lib/replay";

export const metadata = { title: "Manta: replay" };

type Params = Record<string, string | string[] | undefined>;

export default function ReplayPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="wide">
      <h1>Replay</h1>
      <p className="muted">
        A past close on Kalshi, minute by minute: every strike&apos;s best bid and ask and where
        the number settled, for Kalshi&apos;s ladders of &ldquo;above&rdquo; contracts in crypto,
        stock indexes and economics; for Bitcoin also our fair value from Deribit&apos;s options
        and Bitcoin&apos;s price. Kalshi publishes no
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
  const all = await getPastEvents();
  const families = REPLAY_FAMILIES.filter((f) => all.some((x) => x.family === f));
  const chosenEvent = all.find((x) => x.event === e);
  const fam = chosenEvent?.family ?? (Array.isArray(p.f) ? p.f[0] : p.f) ?? "KXBTCD";
  const past = all.filter((x) => x.family === fam);
  if (past.length === 0)
    return <p className="muted">No finished replay yet: the first appears an hour or so after a close.</p>;
  const chosen = chosenEvent ?? past[0];
  const r = await getReplay(chosen.event);
  return (
    <>
      <p className="replay-families">
        {families.map((f) =>
          f === fam ? (
            <strong key={f}>{familyName(f)}</strong>
          ) : (
            <Link key={f} href={`/replay?f=${f}`}>
              {familyName(f)}
            </Link>
          ),
        )}
      </p>
      <h2>
        {familyName(chosen.family)}, closing {utc(chosen.close)}
        {r?.settlement != null && (
          <span className="muted"> · settled on {settled(chosen.family, r.settlement)}</span>
        )}
      </h2>
      {r === null || r.markets.length === 0 ? (
        <p className="muted">No contract of this close was in play in its last six hours.</p>
      ) : (
        <ReplayView key={r.event} r={r} />
      )}
      <h2>Other closes</h2>
      <p className="small">
        Bitcoin from 2026-11-17, the other families from 2026-11-17 12:00 UTC. Fair values and
        Bitcoin&apos;s price are the tracker&apos;s once-a-minute readings. An event listed in the hour before its close starts recording up
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

// Crypto settles on a 60-second average to the cent, and strikes sit a cent below round numbers
// ($64,249.99): show the cents. Everything else in its family's unit.
const settled = (family: string, x: number) =>
  family === "KXBTCD" || family === "KXETHD"
    ? "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : fmtValue(family, x);
