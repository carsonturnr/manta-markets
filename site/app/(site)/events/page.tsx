// Event response (docs/product.md, tool 15): the releases we have measured, one card each with
// its biggest mover's chart. Listed under the header's Tools menu.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import MoveChart from "@/components/MoveChart";
import { cents, et, getReleases, na, reacting, seconds } from "@/lib/events-response";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: event response" };

export default function EventsPage() {
  return (
    <>
      <h1>Event response</h1>
      <p className="muted">
        When payrolls, CPI or the Fed&apos;s decision comes out, the contracts still trading
        reprice. See how far and how fast they moved, and how much the order books thinned just
        before, so you know what to expect at the next release.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Releases />
      </Suspense>
    </>
  );
}

async function Releases() {
  await connection(); // request time only: the build never calls the replay server
  const all = await getReleases();
  if (all.length === 0)
    return <p className="muted">No release measured yet: the first in our data is payrolls on Dec 4, 13:30 UTC.</p>;
  return (
    <div className="ev-cards">
      {all.map((r) => {
        const moved = reacting(r.contracts);
        const top = moved[0];
        return (
          <Link key={r.release} href={`/events/${r.release}`} className="panel ev-card">
            <header className="ph">
              <h2>{r.name}</h2>
              {r.standin && (
                <span className="tag" title="Measured on a moment that is not a release, to test the method">
                  test run
                </span>
              )}
              <span className="right m3 num">{utc(r.t0)}</span>
            </header>
            {top ? (
              <>
                <MoveChart mids={top.mids} t0={r.t0} label={top.ticker} />
                <p className="note">
                  {moved.length} of {r.contracts.length} contracts moved 1¢ or more. Biggest:{" "}
                  <span className="mono">{top.ticker}</span>, {na(top.move_cents, cents)}, 90% of
                  the way in {na(top.time_to_90_ms, seconds)}. {et(r.t0)}.
                </p>
              </>
            ) : (
              <p className="note">
                No contract moved 1¢ or more ({r.contracts.length} measured). {et(r.t0)}.
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
