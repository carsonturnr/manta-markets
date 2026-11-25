import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import DistChart from "@/components/DistChart";
import { type Dist, distKey, expects, fmtValue, getDistributions } from "@/lib/distributions";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";

export const metadata = { title: "Manta: distributions" };

type Params = Record<string, string | string[] | undefined>;

export default function DistributionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <h1>Distributions</h1>
      <p>
        A ladder of contracts on one number (&ldquo;Bitcoin above $64,000&rdquo;, &ldquo;above
        $65,000&rdquo;, …) prices the chance of every outcome, so together they are the
        market&apos;s probability distribution for that number: what it expects, and how sure it is.
        Below, the next ladder to close in each market, in one sentence and a chart. Refreshed every
        minute.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Distributions searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const NAME = new Map(FAMILIES.map((f) => [f.family, f.name]));
const venueName = (v: string) =>
  v === "kalshi" ? "Kalshi" : v === "polymarket" ? "Polymarket" : "Both";
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);
const THIN = 0.05; // a median spread this wide: the ladder is thinly quoted
const rank = (family: string) => {
  const i = FAMILIES.findIndex((f) => f.family === family);
  return i < 0 ? 999 : i;
};

async function Distributions({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const p = await searchParams;
  const e = (Array.isArray(p.e) ? p.e[0] : p.e) ?? "";
  const dists = await getDistributions();
  if (dists.length === 0) return <p className="muted">No distributions yet.</p>;
  const now = dists[0].updated;
  const chosen =
    dists.find((d) => distKey(d) === e) ??
    dists.find((d) => d.family === "KXBTCD" && d.close - now > 3_600_000) ??
    dists[0];
  // The soonest ladder per market (dists come in close order), the featured one's market apart.
  const soonest = new Map<string, Dist>();
  for (const d of dists) if (!soonest.has(d.family)) soonest.set(d.family, d);
  soonest.delete(chosen.family);
  const next = [...soonest.values()].sort((a, b) => rank(a.family) - rank(b.family));
  return (
    <>
      <Ladder d={chosen} big />

      <h2>What each market expects</h2>
      <p className="muted section-lede">
        The next ladder to close in each market. The shaded band is the likely range: the market
        gives it a 50% chance. The dashed line is the middle estimate, as likely to be beaten as
        not.
      </p>
      <div className="legend">
        <span>
          <span className="key" style={{ background: "var(--kalshi)", height: 2 }} />
          Chance it ends above x
        </span>
        <span>
          <span className="key" style={{ background: "var(--kalshi)", opacity: 0.15 }} />
          Likely range (middle 50%)
        </span>
        <span>
          <span className="key" style={{ background: "var(--text-3)", height: 2 }} />
          Middle estimate (dashed)
        </span>
      </div>
      <div className="dist-cards">
        {next.map((d) => (
          <Ladder key={distKey(d)} d={d} />
        ))}
      </div>

      <details className="more">
        <summary>Show every ladder ({dists.length})</summary>
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th style={{ textAlign: "left" }}>Venue</th>
                  <th>Closes</th>
                  <th>Middle estimate</th>
                  <th>Likely range (50%)</th>
                  <th>Mean ± sd</th>
                  <th>Implied vol</th>
                  <th>Median spread</th>
                </tr>
              </thead>
              <tbody>
                {dists.map((d) => (
                  <tr key={distKey(d)} className={d === chosen ? "selected" : undefined}>
                    <td>
                      <Link href={`/distributions?e=${encodeURIComponent(distKey(d))}`}>
                        {NAME.get(d.family) ?? d.family}
                      </Link>
                    </td>
                    <td style={{ textAlign: "left" }}>{venueName(d.venue)}</td>
                    <td className="num">{utc(d.close)}</td>
                    <td className="num">{fmtValue(d.family, d.median)}</td>
                    <td className="num">
                      {d.q25 === null || d.q75 === null
                        ? "–"
                        : `${fmtValue(d.family, d.q25)} – ${fmtValue(d.family, d.q75)}`}
                    </td>
                    <td className="num">
                      {d.mean === null || d.sd === null
                        ? "–"
                        : `${fmtValue(d.family, d.mean)} ± ${fmtValue(d.family, d.sd)}`}
                    </td>
                    <td className="num">
                      {pct(d.vol)}
                      {d.deribitVol !== null && (
                        <span className="muted"> ({pct(d.deribitVol)})</span>
                      )}
                    </td>
                    <td className="num">
                      {d.spread === null ? "–" : `${(d.spread * 100).toFixed(1)}¢`}
                      {d.spread !== null && d.spread >= THIN && (
                        <span className="muted"> thin</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            Values sit where the fitted curve crosses 50%, 75% and 25%; a dash means the quoted
            strikes don&apos;t reach that far. The mean is given only when less than 5% of the
            chance lies beyond each end of the ladder. Events closing within 15 minutes are left
            out: by then almost every contract is at 0 or 1¢. Implied vol in brackets:
            Deribit&apos;s. &ldquo;Thin&rdquo;: a median spread of 5¢ or more, where the
            distribution rests on wide quotes and moves a lot with each one. Snapshot of {utc(now)}.
          </p>
        </section>
      </details>

      <h2>How it&apos;s measured</h2>
      <section className="panel pad prose-sm">
        <p>
          Each ladder is first made consistent (a higher strike can&apos;t be more likely), the same
          fit as the <Link href="/screener">fair values</Link>: quotes weighted by how tight they
          are, both venues combined for economics.
        </p>
      </section>
    </>
  );
}

/** One ladder: what it expects in a sentence, then its chart. `big`: the featured one. */
function Ladder({ d, big = false }: { d: Dist; big?: boolean }) {
  const thin = d.spread !== null && d.spread >= THIN;
  const name = NAME.get(d.family) ?? d.family;
  return (
    <section className={big ? "panel dist-panel" : "panel dist-card"}>
      <header className="ph">
        <h2>
          {big ? (
            name
          ) : (
            <Link href={`/distributions?e=${encodeURIComponent(distKey(d))}`}>{name}</Link>
          )}
          <span className="m3">: {d.title}</span>
        </h2>
        <span className="right m3">{venueName(d.venue)}</span>
      </header>
      <p className={big ? "pad expects big-expects" : "pad expects"}>
        {expects(d.family, d, utc(d.close))}
        {thin && <span className="muted"> Thinly quoted: read it as rough.</span>}
      </p>
      <div className="pad chart-pad">
        <DistChart d={d} width={big ? 900 : 600} legend={big} />
      </div>
      <p className="note">
        {d.curve.length} strikes,{" "}
        {d.method === "consensus-2" ? "both venues' quotes combined" : "one venue's quotes"}
        {d.vol !== null && (
          <>
            {" "}
            · implied volatility (how big a move it expects, as a yearly rate) {pct(d.vol)}
            {d.deribitVol !== null && <> (Deribit options: {pct(d.deribitVol)})</>}
          </>
        )}
      </p>
    </section>
  );
}
