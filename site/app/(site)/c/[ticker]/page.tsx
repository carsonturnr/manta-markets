import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import GapChart from "@/components/GapChart";
import { cents, cents1, describe, gap, price, utc } from "@/lib/format";
import { getContract } from "@/lib/queries";
import { outside } from "@/lib/tracker-view";

export default function ContractPage({ params }: PageProps<"/c/[ticker]">) {
  return (
    <>
      <p className="small">
        <Link href="/tracker">← Bitcoin fair value, every contract</Link>
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
      {last && !c.result && (
        <p className="big-expects">
          <Now bid={last.bid} ask={last.ask} fair={last.fair} />
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
      <h2>Kalshi against fair value, minute by minute</h2>
      {points.length < 2 ? (
        <p className="muted">Not enough snapshots yet to draw a line.</p>
      ) : (
        <GapChart points={points} />
      )}
      <p className="small">
        The band is Kalshi&apos;s bid to ask: buy at the top edge, sell at the bottom. The line is
        Manta&apos;s fair value, the chance implied by Deribit&apos;s Bitcoin options. Where the
        line leaves the band, the tint marks the gap: wider than Kalshi&apos;s spread.
      </p>
    </>
  );
}

/** The contract now, in one sentence: where fair value sits against Kalshi's bid–ask. */
function Now({ bid, ask, fair }: { bid: number; ask: number; fair: number | null }) {
  const k = `${cents(bid)}–${cents(ask)}¢`;
  if (fair === null)
    return <>Kalshi {k}. No fair value in the final 60 seconds before the close.</>;
  const by = outside({ bid, ask, fair });
  if (by === 0)
    return (
      <>
        Kalshi {k}, fair value {cents1(fair)}¢: inside Kalshi&apos;s spread, so the options and
        Kalshi agree.
      </>
    );
  return (
    <>
      Kalshi {k}, fair value {cents1(fair)}¢:{" "}
      <span className={by > 0 ? "up" : "down"}>
        {Math.abs(by).toFixed(1)}¢ {by > 0 ? "above the ask" : "below the bid"}
      </span>
      . By the options, &ldquo;yes&rdquo; is priced {by > 0 ? "low" : "high"} on Kalshi.
    </>
  );
}
