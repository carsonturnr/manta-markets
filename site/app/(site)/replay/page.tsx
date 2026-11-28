import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import ReplayView from "@/components/ReplayView";
import { utc } from "@/lib/format";
import { fmtValue } from "@/lib/units";
import { familyName, getPastEvents, getRecordedFamilies, getReplay, REPLAY_FAMILIES } from "@/lib/replay";

export const metadata = { title: "Manta: replay" };

type Params = Record<string, string | string[] | undefined>;

export default function ReplayPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="wide">
      <h1>Replay</h1>
      <p className="muted">Past Kalshi closes, minute by minute, from order books Kalshi doesn&apos;t publish.</p>
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
  const fam = e ? e.split("-")[0] : ((Array.isArray(p.f) ? p.f[0] : p.f) ?? "KXBTCD");
  const families = await getRecordedFamilies();
  const links = (
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
  );
  if (!REPLAY_FAMILIES.includes(fam))
    return (
      <>
        <p>There&apos;s no replay for {fam}.</p>
        {links}
      </>
    );
  const past = await getPastEvents(fam);
  if (past.length === 0)
    return (
      <>
        {links}
        <p className="muted">No {familyName(fam)} close recorded yet.</p>
      </>
    );
  const chosen = past.find((x) => x.event === e) ?? past[0];
  const r = await getReplay(chosen.event);
  const recent = past.slice(0, 12);
  const closeLink = (x: (typeof past)[number]) =>
    x.event === chosen.event ? (
      <strong>{utc(x.close)}</strong>
    ) : (
      <Link href={`/replay?e=${encodeURIComponent(x.event)}`}>{utc(x.close)}</Link>
    );
  return (
    <>
      {links}
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
      <ul className="replay-list">
        {recent.map((x) => (
          <li key={x.event}>{closeLink(x)}</li>
        ))}
      </ul>
      {past.length > recent.length && (
        <details className="more">
          <summary>All {past.length}</summary>
          <ul className="replay-list">
            {past.slice(recent.length).map((x) => (
              <li key={x.event}>{closeLink(x)}</li>
            ))}
          </ul>
        </details>
      )}
      <details className="more">
        <summary>How the replay is built</summary>
        <p className="small">
          Kalshi publishes no historical order books. These are rebuilt from our own recordings of
          its live feed, every update applied in order, and checked against Kalshi&apos;s own
          snapshots of the book with no mismatch. Each minute shows the book as it stood just
          before the minute began. Bitcoin also shows Manta&apos;s fair value from Deribit&apos;s
          options and Bitcoin&apos;s price, the tracker&apos;s once-a-minute readings.
        </p>
        <p className="small">
          Bitcoin from 2026-11-17, the other families from 2026-11-17 12:00 UTC. An event listed
          in the hour before its close starts recording up to 10 minutes late: the recorder checks
          Kalshi&apos;s list of markets every 10 minutes.
        </p>
      </details>
    </>
  );
}

// Crypto settles on a 60-second average to the cent, and strikes sit a cent below round numbers
// ($64,249.99): show the cents. Everything else in its family's unit.
const settled = (family: string, x: number) =>
  family === "KXBTCD" || family === "KXETHD"
    ? "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : fmtValue(family, x);
