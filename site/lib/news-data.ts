// News events: the reads from the VM's replay server (recorder/cmd/replayserve /news). Kept apart
// from lib/news.ts because next/cache can't load under node's test runner (AGENTS.md).
import { cacheLife } from "next/cache";
import { type MoveDetail, NEWS_KEY, type News } from "./news";
import { fetchReplay } from "./replayserve";

/** Every item of the last 30 days, the move summaries and the collector's poll counts. Cached
 * 30 s: the collector polls every 15 s, so a new item shows within about a minute. */
export async function getNews(): Promise<News> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  return (await (await fetchReplay("/news")).json()) as News;
}

/** One item's contracts and moves; null before its window's replay is written (or a bad key). */
export async function getNewsMove(key: string): Promise<MoveDetail | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 3600 }); // written once, never changed
  if (!NEWS_KEY.test(key)) return null;
  try {
    return (await (await fetchReplay(`/news/moves/${key}.json`)).json()) as MoveDetail;
  } catch (e) {
    if (String(e).endsWith(": 404")) return null;
    throw e;
  }
}
