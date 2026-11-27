// Insights: what happens to the book when official news lands. The headline compares contracts
// moving after each item with the same contracts before it; every item is on /insights/news.
import Link from "next/link";
import { connection } from "next/server";
import { utc } from "@/lib/format";
import { beyondText, joined, overall, sourceName } from "@/lib/news";
import { getNews } from "@/lib/news-data";

export default async function NewsResponse() {
  await connection(); // request time only: the build never calls the replay server
  // If the replay server is down, only this answer is lost, not the whole Insights page.
  const n = await getNews().catch((e) => {
    console.error(e);
    return null;
  });
  if (n === null) return <p className="muted">The news data could not be read right now; try again shortly.</p>;
  const o = overall(n.moves);
  const latest = joined(n).slice(0, 5);
  return (
    <>
      <p className="insight-says">
        {o ? (
          <>
            After official news (Fed, Treasury, BEA, Labor Department, BLS),{" "}
            <Diff after={o.after} before={o.before} /> Kalshi contracts on average moved 1¢ or more
            within 30 minutes than in the 30 minutes before ({Math.round(o.after)} against{" "}
            {Math.round(o.before)}, over {o.moments} {o.moments === 1 ? "moment" : "moments"}). Most
            short-dated contracts move anyway: the difference is what the news may have added.
          </>
        ) : (
          <>Official news is being recorded; its first book moves are measured an hour or two after it lands.</>
        )}
      </p>
      <section className="panel stack">
        <header className="ph">
          <h3>
            <Link href="/insights/news">Latest official news</Link>
          </h3>
        </header>
        <div className="pad">
          {latest.length === 0 ? (
            <p className="muted">No item recorded yet.</p>
          ) : (
            <ul>
              {latest.map(({ it, t, move }) => (
                <li key={it.key}>
                  <span className="num muted">{utc(t)}</span> {sourceName(it.source)}:{" "}
                  <Link href={`/insights/news/${it.key}`}>{it.title}</Link>
                  {move && !move.release && move.contracts > 0 && <span className="muted small"> · {beyondText(move)}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="note">
            Each item is timed on our clock, and the books around it are compared with their own
            drift in the 30 minutes before. Every item, the receipt delay by source and the method
            are on the <Link href="/insights/news">news page</Link>.
          </p>
        </div>
      </section>
    </>
  );
}

/** "7 more", "11 fewer", "no more": the headline figure, in bold. */
export function Diff({ after, before }: { after: number; before: number }) {
  const d = Math.round(after - before);
  return <b className="num">{d === 0 ? "no more" : `${Math.abs(d)} ${d > 0 ? "more" : "fewer"}`}</b>;
}
