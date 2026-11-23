// Event response (docs/product.md, tool 15): the releases we have measured. Reachable by URL
// until the header nav gets its link (carsonturnr/positioning).
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { et, getReleases } from "@/lib/events-response";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: event response" };

export default function EventsPage() {
  return (
    <>
      <h1>Event response</h1>
      <p className="muted">
        How contracts still trading moved around each scheduled economic release (payrolls and
        unemployment, CPI, the Fed&apos;s decision): how far, how fast, and how their order books
        thinned just before the number. Measured from our own recordings of the venues&apos; feeds.
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
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Release</th>
            <th>UTC</th>
            <th>New York</th>
            <th>Contracts measured</th>
          </tr>
        </thead>
        <tbody>
          {all.map((r) => (
            <tr key={r.release}>
              <td>
                <Link href={`/events/${r.release}`}>{r.name}</Link>
                {r.standin && (
                  <>
                    {" "}
                    <span className="tag" title="Measured on a moment that is not a release, to test the method">
                      test run
                    </span>
                  </>
                )}
              </td>
              <td className="num">{utc(r.t0)}</td>
              <td className="num">{et(r.t0)}</td>
              <td className="num">{r.contracts.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
