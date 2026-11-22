import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import DistChart from "@/components/DistChart";
import TermChart from "@/components/TermChart";
import {
  type Dist,
  distKey,
  fmtValue,
  getDistributions,
  onWhat,
  UNDERLYINGS,
  underlying,
} from "@/lib/distributions";
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
        market&apos;s probability distribution for that number. Refreshed every minute.
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
  return (
    <>
      <Selected d={chosen} />

      <h2>Volatility by horizon</h2>
      <p className="muted section-lede">
        How much each market expects the price to move, by time to close: the implied volatility,
        in percent a year (the usual unit: 50% a year is about 2.6% a day). If the logarithm of the
        price is normally distributed, as options models assume, its middle 50% spans 1.349
        standard deviations, so the volatility is ln(75th / 25th percentile) ÷ (1.349 × √years to
        close). For Bitcoin and Ether, the line is Deribit&apos;s options market at the same
        closes (at-the-money volatility). Stock indexes and FX count calendar time, nights and
        weekends included, so their figures read lower than the usual trading-day ones. A ladder
        gets a volatility only when at least two of its strikes fall inside its middle 50%:
        coarser ladders, and most within an hour of the close, can&apos;t measure it.
      </p>
      <div className="legend">
        <span>
          <span className="key" style={{ background: "var(--kalshi)" }} />
          Kalshi
        </span>
        <span>
          <span className="key" style={{ background: "var(--poly)" }} />
          Polymarket
        </span>
        <span>
          <span className="key" style={{ background: "var(--fair)", height: 2 }} />
          Deribit options
        </span>
      </div>
      <div className="grid-2">
        {UNDERLYINGS.map((u) => (
          <TermChart
            key={u}
            name={u}
            dists={dists.filter((d) => underlying(d.family) === u)}
            now={now}
          />
        ))}
      </div>

      <h2>Every ladder</h2>
      <section className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th style={{ textAlign: "left" }}>Venue</th>
              <th>Closes</th>
              <th>Median</th>
              <th>Middle 50%</th>
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
                  {d.deribitVol !== null && <span className="muted"> ({pct(d.deribitVol)})</span>}
                </td>
                <td className="num">
                  {d.spread === null ? "–" : `${(d.spread * 100).toFixed(1)}¢`}
                  {d.spread !== null && d.spread >= THIN && <span className="muted"> thin</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Values sit where the fitted curve crosses 50%, 75% and 25%; a dash means the quoted strikes
        don&apos;t reach that far. The mean is given only when less than 5% of the chance lies
        beyond each end of the ladder. Events closing within 15 minutes are left out: by then
        almost every contract is at 0 or 1¢. Implied vol in brackets: Deribit&apos;s.
        &ldquo;Thin&rdquo;: a median spread of 5¢ or more, where the distribution rests on wide
        quotes and moves a lot with each one. Snapshot of {utc(now)}.
      </p>
      </section>

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

function Selected({ d }: { d: Dist }) {
  const thin = d.spread !== null && d.spread >= THIN;
  return (
    <div className="split">
      <section className="panel">
        <header className="ph">
          <h2>
            {NAME.get(d.family) ?? d.family}: {d.title}
          </h2>
        </header>
        <div className="pad chart-pad">
          <DistChart d={d} />
        </div>
      </section>
      <aside className="panel figures">
        <header className="ph">
          <h2>The market says</h2>
          <span className="right m3">{venueName(d.venue)}</span>
        </header>
        <dl className="pad">
          <div>
            <dt>Median</dt>
            <dd className="big num">{fmtValue(d.family, d.median)}</dd>
          </div>
          <div>
            <dt>Even odds between</dt>
            <dd className="num">
              {d.q25 === null || d.q75 === null
                ? "–"
                : `${fmtValue(d.family, d.q25)} – ${fmtValue(d.family, d.q75)}`}
            </dd>
          </div>
          <div>
            <dt>Implied volatility</dt>
            <dd className="num">
              {pct(d.vol)}
              {d.deribitVol !== null && <span className="m3"> · Deribit {pct(d.deribitVol)}</span>}
            </dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd className="num">{utc(d.close)}</dd>
          </div>
          <div>
            <dt>Strikes</dt>
            <dd className="num">
              {d.curve.length}
              <span className="m3">
                {" "}
                · {d.method === "consensus-2" ? "both venues' quotes combined" : "one venue's quotes"}
              </span>
            </dd>
          </div>
        </dl>
        <p className="note">
          The market puts the median of {onWhat(d.family)} at {fmtValue(d.family, d.median)}
          {d.q25 !== null && d.q75 !== null && (
            <>
              {" "}
              and gives even odds it lands between {fmtValue(d.family, d.q25)} and{" "}
              {fmtValue(d.family, d.q75)}
            </>
          )}
          .
          {d.vol !== null && (
            <>
              {" "}
              That spread implies a volatility of {pct(d.vol)} a year
              {d.deribitVol !== null && <>, against {pct(d.deribitVol)} on Deribit&apos;s options</>}.
            </>
          )}
          {thin && " Thinly quoted: read it as rough."}
        </p>
      </aside>
    </div>
  );
}
