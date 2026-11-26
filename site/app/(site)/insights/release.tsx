// Insights: how the book behaves around a data release. Folded in from the old /events page
// (2026-11-26). Shows the newest real release, or the newest test run (clearly labelled) until the
// first real one, payrolls on 2026-12-04; each release has its own page under /insights/releases.
import Link from "next/link";
import { connection } from "next/server";
import MoveChart from "@/components/MoveChart";
import { cents, et, getReleases, na, reacting, seconds, thinning } from "@/lib/events-response";
import { utc } from "@/lib/format";

const VENUE: Record<string, string> = { kalshi: "Kalshi", polymarket: "Polymarket" };

export default async function ReleaseResponse() {
  await connection(); // request time only: the build never calls the replay server
  // The release files come from the replay server on the VM; if it is down, only this answer is
  // lost, not the whole Insights page.
  const all = await getReleases().catch((e) => {
    console.error(e);
    return null;
  });
  if (all === null)
    return <p className="muted">The release data could not be read right now; try again shortly.</p>;
  const shown = all.find((r) => !r.standin) ?? all[0];
  if (!shown)
    return (
      <p className="muted">
        No release measured yet: the first in our data is payrolls on Dec 4, 13:30 UTC.
      </p>
    );
  const moved = reacting(shown.contracts);
  const top = moved[0];
  return (
    <>
      {shown.standin && (
        <p className="warn">
          <span className="tag">test run</span> Not a release: a moment with a known move, used to
          test the method. The first real release in our data is payrolls on Dec 4, 13:30 UTC (8:30
          in New York); this section switches to it once it is measured.
        </p>
      )}
      <p className="insight-says">
        {top ? (
          <>
            {shown.standin ? "In the test run" : `At ${shown.name}`}, {moved.length} of{" "}
            {shown.contracts.length} contracts still trading moved 1¢ or more. The biggest,{" "}
            {VENUE[top.venue] ?? top.venue} <span className="mono">{top.ticker}</span>, moved{" "}
            <b className="num">{na(top.move_cents, cents)}</b> and got 90% of the way in{" "}
            <b className="num">{na(top.time_to_90_ms, seconds)}</b>; its book within 2¢ of the price
            went from{" "}
            <span className="num">{thinning(top.depth_10m_before, top.depth_30s_before)}</span>{" "}
            contracts between 10 minutes and 30 seconds before.
          </>
        ) : (
          <>No contract of the {shown.contracts.length} measured moved 1¢ or more.</>
        )}
      </p>
      <section className="panel stack">
        <header className="ph">
          <h3>
            <Link href={`/insights/releases/${shown.release}`}>{shown.name}</Link>
          </h3>
          <span className="right m3 num">
            {utc(shown.t0)} · {et(shown.t0)}
          </span>
        </header>
        <div className="pad insight-pair">
        {top ? (
          <div>
            <MoveChart mids={top.mids} t0={shown.t0} label={top.ticker} />
          </div>
        ) : (
          <p className="muted">Nothing moved enough to chart.</p>
        )}
        <p className="note">
          The biggest mover&apos;s midpoint (halfway between bid and ask), 15 minutes before to 30
          after; the line marks the release. <b>Time to 90%</b>: how long the price took to cover
          90% of its move. Every contract, chart and figure is on the{" "}
          <Link href={`/insights/releases/${shown.release}`}>release&apos;s own page</Link>.
        </p>
        </div>
      </section>
      {all.length > 1 && (
        <p className="small muted">
          Also measured:{" "}
          {all
            .filter((r) => r !== shown)
            .map((r, i) => (
              <span key={r.release}>
                {i > 0 && "; "}
                <Link href={`/insights/releases/${r.release}`}>{r.name}</Link>
                {r.standin && " (test run)"}
              </span>
            ))}
          .
        </p>
      )}
    </>
  );
}
