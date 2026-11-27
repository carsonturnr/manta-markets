// One news item: when it was stated and received, and each contract's midpoint from 30 minutes
// before to 30 after, its move against its own move over the 30 minutes before.
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import MoveChart from "@/components/MoveChart";
import { et } from "@/lib/events-response";
import { utc } from "@/lib/format";
import { beyondText, delay, duration, NEWS_KEY, SOURCES, signed, sourceName, t0 } from "@/lib/news";
import { getNews, getNewsMove } from "@/lib/news-data";

export const metadata = { title: "Manta: news event" };

export default function NewsItemPage({ params }: PageProps<"/insights/news/[key]">) {
  return (
    <div className="wide">
      <p className="crumbs">
        <Link href="/insights/news">Official news</Link>
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <ItemView params={params} />
      </Suspense>
    </div>
  );
}

async function ItemView({ params }: Pick<PageProps<"/insights/news/[key]">, "params">) {
  await connection(); // request time only: the build never calls the replay server
  const { key } = await params;
  if (!NEWS_KEY.test(key)) notFound();
  const [news, detail] = await Promise.all([getNews(), getNewsMove(key)]);
  const it = news.items.find((i) => i.key === key);
  if (!it) notFound();
  const move = news.moves.find((m) => m.key === key);
  const at = t0(it);
  const d = delay(it);
  const charted = detail?.contracts.filter((c) => c.mids) ?? [];
  return (
    <>
      <h1>{it.title}</h1>
      <p className="muted">
        {sourceName(it.source)} · stated {utc(it.stated_ms)} ({et(it.stated_ms)})
        {!it.stated_real && " (not a real publication time)"} · received{" "}
        {it.backfill ? "when our collector started (no real receipt time)" : utc(it.received_ms)}
        {d !== null && `, ${duration(d)} after`}.{" "}
        <a href={it.url} rel="noopener noreferrer">
          Read it at the source →
        </a>
      </p>

      {move?.release ? (
        <p className="lead-says">
          This item came with a scheduled release, measured on{" "}
          <Link href={`/insights/releases/${move.release}`}>the release&apos;s own page</Link>.
        </p>
      ) : !detail || !move || !at ? (
        <p className="lead-says">
          {at
            ? "Not measured yet: each item is measured after its hour's replay, one to two hours later."
            : "No known time: this item was already in the feed when our collector started, and its source's stated time is not a real publication time."}
        </p>
      ) : (
        <>
          <p className="lead-says">
            <b className="num">{move.moved}</b> of {move.contracts} contracts moved 1¢ or more in the
            30 minutes after, against <b className="num">{move.moved_before}</b> in the 30 minutes
            before: <b className="num">{beyondText(move)}</b>.
          </p>
          <p className="muted small">
            Measured from the {at.kind === "stated" ? "source's stated time" : "time we received it"}, {utc(at.t)}
            {at.kind === "received" &&
              ": the market may already have reacted before then, since the source's own time is not a real publication time"}
            . Minute resolution; other news in the same hour is not separated from this item.
          </p>

          <h2>How the contracts moved</h2>
          {charted.length === 0 ? (
            <p className="muted">No contract moved by 1¢ or more.</p>
          ) : (
            <>
              <p className="muted small">
                The {charted.length} biggest movers; the table lists every contract.
              </p>
              <div className="response-charts">
                {charted.map((c) => (
                  <figure key={c.ticker}>
                    <figcaption className="small">
                      <span className="mono">{c.ticker}</span> · {signed(c.move_cents)} (before {signed(c.before_cents)})
                    </figcaption>
                    <MoveChart mids={c.mids!} t0={at.t - (at.t % 60_000)} label={c.ticker} before={30} what="the item" />
                  </figure>
                ))}
              </div>
            </>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kalshi contract</th>
                  <th>Move, 30 min after</th>
                  <th>Move, 30 min before</th>
                </tr>
              </thead>
              <tbody>
                {detail.contracts.map((c) => (
                  <tr key={c.ticker}>
                    <td className="mono">{c.ticker}</td>
                    <td className="num">{signed(c.move_cents)}</td>
                    <td className="num">{signed(c.before_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="small muted">Source: {SOURCES[it.source]?.agency ?? it.source} (public domain).</p>
    </>
  );
}
