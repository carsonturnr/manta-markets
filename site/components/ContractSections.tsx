// The parts of a contract that aren't live panels, shared by the Market page, the terminal and the
// home page: its price chart, its rules and the link out to the venue. Server components: each
// fetches its own data (lib/venues.ts, cached briefly) inside a Suspense boundary. The live panels
// (book, depth, trades, cost) are in terminal/LivePanels.tsx, the rest in terminal/Panels.tsx.
import CandleChart from "@/components/CandleChart";
import { BriefPanel } from "@/components/terminal/Panels";
import { getBrief } from "@/lib/brief-api";
import { marks } from "@/lib/news";
import { getNews } from "@/lib/news-data";
import { getContract } from "@/lib/queries";
import type { Row } from "@/lib/screener";
import { kalshiCandles, kalshiRules, polyCandles, polyRules } from "@/lib/venues";

export const unavailable = (what: string, venue: string) => (
  <p className="muted">
    {what} unavailable right now: {venue === "kalshi" ? "Kalshi" : "Polymarket"} didn&apos;t answer.
  </p>
);

// Official news marks for the chart (tool 16). The replay server being down costs the marks, not
// the chart.
const newsMarks = () =>
  getNews()
    .then((n) => marks(n.items))
    .catch((e) => {
      console.error(e);
      return [];
    });

export async function Chart({ c, yesToken, tracked }: { c: Row; yesToken?: string; tracked: boolean }) {
  // Both resolutions at once, so switching timeframe on the chart needs no new request.
  if (c.venue === "kalshi") {
    const [m1, h1, ours, news] = await Promise.all([
      kalshiCandles(c.family, c.id, "1m"),
      kalshiCandles(c.family, c.id, "1h"),
      tracked ? getContract(c.id) : null, // our fair value, recorded once a minute
      newsMarks(),
    ]);
    if (!m1 || !h1) return unavailable("Price history", c.venue);
    const fair = ours?.points.flatMap((p) => (p.fair === null ? [] : [{ t: p.t, fair: p.fair }]));
    return <CandleChart kalshi={{ m1, h1 }} fair={fair} close={c.close} news={news} />;
  }
  if (!yesToken) return unavailable("Price history", c.venue);
  const [m1, h1, news] = await Promise.all([polyCandles(yesToken, "1m"), polyCandles(yesToken, "1h"), newsMarks()]);
  if (!m1 || !h1) return unavailable("Price history", c.venue);
  return <CandleChart poly={{ m1, h1 }} close={c.close} news={news} />;
}

/** The venue's own page for this contract's event, where it can be traded (Manta places no
 * orders). Checked 2026-11-25: kalshi.com/markets/<series>/<event> redirects to the event's page;
 * polymarket.com/event/<slug> is the event's page. */
export function TradeLink({ c }: { c: Pick<Row, "venue" | "family" | "event"> }) {
  const href =
    c.venue === "kalshi"
      ? `https://kalshi.com/markets/${c.family.toLowerCase()}/${c.event.toLowerCase()}`
      : `https://polymarket.com/event/${encodeURIComponent(c.event)}`;
  return (
    <a className="trade-link" href={href} target="_blank" rel="noopener noreferrer">
      Trade on {c.venue === "kalshi" ? "Kalshi" : "Polymarket"} →
    </a>
  );
}

/** The AI brief (terminal/Panels.tsx BriefPanel) as a section of its own, for a page outside the
 * panel layout (home). Renders nothing when the key is missing or the call fails. */
export async function MarketBrief({ c }: { c: Pick<Row, "venue" | "id"> }) {
  if (!(await getBrief(c.venue, c.id))) return null; // cached: BriefPanel reuses it
  return (
    <section className="brief">
      <h2>Market brief</h2>
      <BriefPanel venue={c.venue} id={c.id} />
    </section>
  );
}

export async function RulesSection({ c }: { c: Row }) {
  const rules = c.venue === "kalshi" ? await kalshiRules(c.id) : await polyRules(c.event);
  if (!rules) return unavailable("The rules", c.venue);
  return (
    <div className="rules">
      {/* The venue's own words, unedited: said once, up front. */}
      {rules.paragraphs.map((p, i) => (
        <p key={i}>
          {i === 0 && <b>From {c.venue === "kalshi" ? "Kalshi" : "Polymarket"}: </b>}
          {p}
        </p>
      ))}
    </div>
  );
}
