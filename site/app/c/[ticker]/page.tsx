import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import GapChart from "@/components/GapChart";
import { cents, cents1, describe, gap, price, utc } from "@/lib/format";
import { getContract } from "@/lib/queries";

export default function ContractPage({ params }: PageProps<"/c/[ticker]">) {
  return (
    <>
      <p className="small">
        <Link href="/">← all contracts</Link>
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        {params.then(({ ticker }) => (
          <Contract ticker={decodeURIComponent(ticker)} />
        ))}
      </Suspense>
    </>
  );
}

async function Contract({ ticker }: { ticker: string }) {
  await connection(); // request time only: the build never queries the database
  const data = await getContract(ticker);
  if (!data) notFound();
  const { contract: c, points } = data;
  const last = points.at(-1);

  return (
    <>
      <h1>Pays $1 if BTC is {describe(c)}</h1>
      <p className="muted">
        Closes {utc(c.close)}, on the average of the CF Benchmarks BTC index over the final 60
        seconds. Kalshi ticker <span className="num">{c.ticker}</span>.
      </p>
      {c.result && (
        <p className="warn">
          Settled <b>{c.result}</b> at {price(c.settlement!)} (Kalshi&apos;s 60-second average).
        </p>
      )}
      {last && (
        <div className="stats">
          <div>
            <span>Kalshi bid / ask</span>
            <b className="num">
              {cents(last.bid)} / {cents(last.ask)}
            </b>
          </div>
          <div>
            <span>Fair value</span>
            <b className="num">{last.fair === null ? "–" : cents1(last.fair)}</b>
          </div>
          <div>
            <span>Gap (fair − mid)</span>
            <b className="num">
              {last.fair === null ? "–" : gap(last.fair, last.bid, last.ask).toFixed(1)}
            </b>
          </div>
          <div>
            <span>As of</span>
            <b className="num">{utc(last.t, false).replace(" UTC", "")}</b> UTC
          </div>
        </div>
      )}
      <h2>Minute by minute</h2>
      {points.length < 2 ? (
        <p className="muted">Not enough snapshots yet to draw a line.</p>
      ) : (
        <GapChart points={points} />
      )}
      <p className="small">
        The band is Kalshi&apos;s bid to ask: buy at the top edge, sell at the bottom. The line is
        our fair value. When the line leaves the band, the two markets disagree by more than
        Kalshi&apos;s spread.
      </p>
    </>
  );
}
