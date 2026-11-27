// Where the retired pages' URLs lead now (each old page is a redirect, app/(site)/contract, c,
// tracker and distributions): every contract and ladder lives on its event's Market page.
import { getEvents } from "./events";
import { getMarket } from "./screener";

/** The Market page with this contract in focus. A contract that has left the listing (closed) is
 * found by its ticker on Kalshi, whose market tickers are the event's plus one more part
 * (KXBTCD-26NOV2617-T60249.99); a closed Polymarket contract goes to Markets. */
export async function contractUrl(venue: string, id: string): Promise<string> {
  const got = venue === "kalshi" || venue === "polymarket" ? await getMarket(venue, id) : null;
  const event = got?.row.event ?? (venue === "kalshi" && id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : null);
  if (!event) return "/markets";
  return `/m/${venue}/${encodeURIComponent(event)}?o=${encodeURIComponent(id)}`;
}

/** An event's Market page; a ladder priced from both venues ("both") opens on Kalshi's. */
export async function eventUrl(venue: string, event: string): Promise<string> {
  const { events } = await getEvents();
  const e = events.find((x) => x.event === event && (x.venue === venue || venue === "both"));
  return e ? `/m/${e.venue}/${encodeURIComponent(e.event)}` : "/markets";
}

/** The Bitcoin ladder the tracker used to open on: Kalshi's next "above" ladder closing more than
 * an hour from now (the terminal's default focus too). */
export async function bitcoinUrl(): Promise<string> {
  const { events, at } = await getEvents();
  const now = at ?? 0;
  const e = events
    .filter((x) => x.family === "KXBTCD" && x.close - now > 3_600_000)
    .sort((a, b) => a.close - b.close)[0];
  return e ? `/m/kalshi/${encodeURIComponent(e.event)}` : "/markets";
}
