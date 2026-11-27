// News events (tool 16): every official news item of the last 30 days on our clock, with the
// receipt delay per source and how Kalshi's books moved around each, against their own drift.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { et } from "@/lib/events-response";
import { utc } from "@/lib/format";
import { beyondText, delay, delays, duration, joined, type News, overall, SOURCES, sourceName } from "@/lib/news";
import { getNews } from "@/lib/news-data";
import { Diff } from "../news";

export const metadata = { title: "Manta: news events" };

// About ten items a day; a month is a few hundred rows. shortcut: no paging; add it past ~500.
const MAX_ROWS = 400;
// The two release-only feeds (recorder/internal/news Sources, ReleaseOnly).
const RELEASE_ONLY = new Set(["dol", "bls-cpi", "bls-payrolls"]);
// Sources whose stated time is not a publication time (recorder/internal/news, StatedReal false).
const STATED_NOT_REAL = new Set([...RELEASE_ONLY, "treasury-press"]);

export default function NewsPage() {
  return (
    <div className="wide">
      <p className="crumbs">
        <Link href="/insights#news">Insights</Link>
      </p>
      <h1>Official news</h1>
      <p className="lede">
        Statements, speeches, auction results and data releases from the Fed, Treasury, BEA, the
        Labor Department and BLS, on the same clock as the order books: when the source says it
        published, when we received it, and how Kalshi&apos;s books moved around it.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <NewsView />
      </Suspense>
    </div>
  );
}

async function NewsView() {
  await connection(); // request time only: the build never calls the replay server
  const n = await getNews().catch((e) => {
    console.error(e);
    return null;
  });
  if (!n) return <p className="muted">The news data could not be read right now; try again shortly.</p>;
  const rows = joined(n);
  return (
    <>
      <p className="lead-says">
        <Says n={n} />
      </p>
      <p className="muted small">
        A move timed from our receipt (Labor Department, BLS and Treasury press releases, whose
        stated times are not real publication times) starts after the market may already have
        reacted. Moves are read at minute resolution.
      </p>

      <h2>Items</h2>
      {rows.length === 0 ? (
        <p className="muted">No item recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="news-table">
            <thead>
              <tr>
                <th>Time</th>
                <th className="text">Source</th>
                <th className="text">Item</th>
                <th>Received after</th>
                <th>Contracts moving 1¢+, 30 min after vs before</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_ROWS).map(({ it, at, t, move }) => {
                const d = delay(it);
                return (
                  <tr key={it.key}>
                    <td className="num">
                      {utc(t)}
                      <span className="muted small">
                        {" "}
                        {at ? at.kind : "stated, not a publication time"}
                      </span>
                    </td>
                    <td className="text">{sourceName(it.source)}</td>
                    <td className="text title">
                      <a href={it.url} rel="noopener noreferrer">
                        {it.title}
                      </a>
                    </td>
                    <td className="num" data-label="Received after">
                      {d !== null ? duration(d) : <span className="muted">{it.backfill ? "n/a" : "no real stated time"}</span>}
                    </td>
                    <td className="num" data-label="1¢+ movers, after vs before">
                      {move?.release ? (
                        <Link href={`/insights/releases/${move.release}`}>at a scheduled release →</Link>
                      ) : move && move.contracts > 0 ? (
                        <>
                          <Link href={`/insights/news/${it.key}`}>{beyondText(move)}</Link>{" "}
                          <span className="muted small">
                            ({move.moved} vs {move.moved_before} of {move.contracts})
                          </span>
                        </>
                      ) : move ? (
                        <span className="muted">no contract measured</span>
                      ) : (
                        <span className="muted">{at ? "pending (after the hour's replay)" : "no known time"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX_ROWS && <p className="muted small">The newest {MAX_ROWS} of {rows.length} items.</p>}

      <h2>Receipt delay by source</h2>
      <Delays n={n} />

      <details className="more">
        <summary>How it is measured</summary>
        <ul className="muted">
          <li>
            <b>Stated time</b>: when the source says it published (an RSS date, an auction&apos;s
            close). <b>Received</b>: when our collector on the recording machine first got it.
            <b> Received after</b> is the difference: the source&apos;s own posting delay plus our
            polling (every 15 s), so a reader of the official page could not have had it much
            sooner.
          </li>
          <li>
            Some stated times are not publication times (checked 2026-11-27): the Labor Department
            dates its jobless-claims release 12:00 UTC though it comes out at 13:30, BLS dates its
            releases about 35 minutes before the 8:30 ET release, and Treasury&apos;s press times
            can sit 10 minutes before posting. Those items get no delay, and their moves are timed
            from our receipt.
          </li>
          <li>
            <b>Midpoint</b>: halfway between the best bid and the best ask, in cents. <b>Move</b>:
            the midpoint 30 minutes after the item&apos;s minute minus the midpoint at it, read from
            our hourly replay files (the book at each minute), so moves are minute-resolution.
          </li>
          <li>
            <b>Before</b>: the same contracts&apos; move over the 30 minutes before. Short-dated
            contracts (hourly index, currency and crypto) move all the time, so the headline is the
            number that moved 1¢ or more after minus the number that did before, counted over the
            contracts with both figures. Items in the same minute share one measurement, and news
            from elsewhere in that hour is not separated from it.
          </li>
          <li>
            An item from the agency of a scheduled release, within 10 minutes of it (the CPI
            headline, the Fed&apos;s statement), is measured on the release&apos;s own page instead.
          </li>
          <li>
            Items already in a feed when the collector (re)starts have no real receipt time: they
            are listed but count in no delay.
          </li>
        </ul>
        <p className="small">
          Sources (public domain): {[...new Set(Object.values(SOURCES).map((s) => s.agency))].join("; ")}.
        </p>
      </details>
    </>
  );
}

/** The headline: across measured moments, contracts moving 1¢ or more after against before. */
function Says({ n }: { n: News }) {
  const o = overall(n.moves);
  if (!o)
    return (
      <>
        No move measured yet: each item is measured after its hour&apos;s replay, one to two
        hours later.
      </>
    );
  return (
    <>
      Across {o.moments} news {o.moments === 1 ? "moment" : "moments"}, <Diff after={o.after} before={o.before} />{" "}
      contracts on average moved 1¢ or more in the 30 minutes after than in the 30 minutes before (
      {Math.round(o.after)} against {Math.round(o.before)}, of about {Math.round(o.contracts)}{" "}
      measured). Most of these contracts move anyway; the difference is what the news may have added.
    </>
  );
}

function Delays({ n }: { n: News }) {
  const feeds = n.status?.feeds ?? {};
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Items timed</th>
              <th>Median</th>
              <th>Range</th>
              <th>Polled</th>
              <th>Failed polls</th>
            </tr>
          </thead>
          <tbody>
            {delays(n.items).map((d) => {
              const f = feeds[d.source];
              return (
                <tr key={d.source}>
                  <td>{sourceName(d.source)}</td>
                  <td className="num">{d.n}</td>
                  {d.median === null ? (
                    <td colSpan={2} className="muted">
                      {STATED_NOT_REAL.has(d.source)
                        ? "stated time not a publication time"
                        : "no item yet"}
                    </td>
                  ) : (
                    <>
                      <td className="num">{duration(d.median)}</td>
                      <td className="num">
                        {duration(d.min!)} – {duration(d.max!)}
                      </td>
                    </>
                  )}
                  <td>{RELEASE_ONLY.has(d.source) ? "15 s, 8:29–8:45 ET weekdays; 5 min otherwise" : "every 15 s"}</td>
                  <td className="num">{f ? `${f.errors} of ${f.polls.toLocaleString("en-US")}` : "n/a"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        A failed poll (an error, or the site refusing us) doubles that feed&apos;s wait, up to 5
        minutes, so a source is never hammered.
        {n.status && ` Poll counts since ${utc(n.status.since_ms)} (${et(n.status.since_ms)}), when the collector last started.`}
      </p>
    </>
  );
}
