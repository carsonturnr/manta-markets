// The terminal's server-rendered panels (fair value, every outcome, arbitrage, distribution,
// catalysts, alerts, the other venue, the Bitcoin fair-value ladder) and the frame every panel
// sits in: used by /terminal, the Market page (/m/...) and the home page's demo of the terminal.
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";
import AlertForm from "@/components/AlertForm";
import DistChart from "@/components/DistChart";
import FairLadder from "@/components/FairLadder";
import VenueLogo from "@/components/VenueLogo";
import { getAlerts, isPaired, isWatched } from "@/lib/account";
import { deleteAlert, toggleWatch } from "@/lib/accountActions";
import { describe } from "@/lib/alerts";
import { arbitrage } from "@/lib/arb";
import { getBrief } from "@/lib/brief-api";
import { crossed, getPairs, type Pair } from "@/lib/compare";
import { kalshiFee, polymarketFee } from "@/lib/cost";
import { fmtValue, getDistributions } from "@/lib/distributions";
import { type Event } from "@/lib/events";
import { utc } from "@/lib/format";
import { beyondText, joined, SOURCES } from "@/lib/news";
import { getNews } from "@/lib/news-data";
import { featured, mid, outcomeLabel, usableFair } from "@/lib/outcomes";
import { getBoard } from "@/lib/queries";
import { score } from "@/lib/scoring";
import { type Row } from "@/lib/screener";
import { METHODS } from "@/lib/settlement";
import { eventScores } from "@/lib/stats";
import { kalshiBook, polyBook, polyTokens } from "@/lib/venues";

const pct = (p: number | null) => (p === null ? "–" : `${(Math.round(p * 1000) / 10).toFixed(1)}%`);
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

/** One sentence per panel, behind the "?" in its header: what it shows, for a trader who knows
 * stock charts but not prediction-market terms. */
export const HELP: Record<string, string> = {
  mon: "Every market Manta follows, with its price, spread and 24-hour move; pick one to put it in focus.",
  chart: "The contract's price over time: a price of 55¢ means the market gives the outcome a 55% chance.",
  book: "Orders waiting to buy (bids) and sell (asks); the gap between the best of each is the spread you pay to trade now.",
  depth: "How many contracts wait near the best prices on each side, so how large a trade the market can take without moving.",
  tape: "Every trade as it prints, newest first: a buy took someone's ask, a sell hit someone's bid.",
  cost: "What buying or selling a number of contracts costs on the live book, after slippage and fees; Manta places no orders.",
  fair: "Manta's own estimate of the chance, from options prices or the other venue, beside the market's price and its track record.",
  board: "Every outcome of this event in one table: each strike or range is its own contract, priced from 0 to 100¢.",
  arb: "The same question on Kalshi and Polymarket; when one's bid is above the other's ask, buying one and selling the other locks in the difference.",
  dist: "The spread of final values the strike prices imply, like reading a probability curve from an option chain.",
  cal: "Scheduled economic releases (jobs, inflation, the Fed) whose contracts close soonest, with the market's favourite outcome.",
  alerts: "Watch this contract, or get an email when its price, spread or depth crosses a level you set.",
  pair: "The same question on the other venue, and its price there.",
  ladder: "Each Bitcoin strike's bid-to-ask range on Kalshi beside Manta's fair value; shading marks a gap wider than the spread.",
  brief: "A short AI summary of Manta's data on this contract: recent moves, the book, trades and fair value.",
};

// The short code and title shown on each panel's header.
export const TITLES: Record<string, [string, string]> = {
  mon: ["MON", "Markets"],
  chart: ["GP", "Price"],
  book: ["BOOK", "Order book"],
  depth: ["DPTH", "Depth and liquidity"],
  tape: ["TAPE", "Trades"],
  cost: ["COST", "Cost to trade"],
  fair: ["FV", "Fair value"],
  board: ["EVT", "Every outcome"],
  arb: ["ARB", "Cross-venue arbitrage"],
  dist: ["DIST", "Implied distribution"],
  cal: ["CAL", "Catalysts"],
  alerts: ["ALRT", "Alerts"],
  pair: ["XV", "Other venue"],
  ladder: ["LADR", "Fair value, every strike"],
  brief: ["AI", "Brief"],
};

/** The frame of one panel: code, title and a "?" with its one-line help, then the body. The
 * terminal places it in its grid (`style`); the Market page stacks it in a column. */
export function Panel({
  k,
  title,
  style,
  children,
}: {
  k: string;
  title?: string; // overrides the standard title where the page names it differently
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [code, name] = TITLES[k];
  const t = title ?? name;
  return (
    <section className="t-panel" data-panel={k} style={style}>
      <header>
        <span className="t-code">{code}</span>
        <h2>{t}</h2>
        <button type="button" className="t-help" aria-label={`About ${t}: ${HELP[k]}`} data-tip={HELP[k]}>
          ?
        </button>
      </header>
      <div className="t-body">{children}</div>
    </section>
  );
}

/** The market brief (lib/brief-api.ts) for the contract in focus, as the market page shows it. */
export async function BriefPanel({ venue, id }: { venue: string; id: string }) {
  const bullets = await getBrief(venue, id);
  return (
    <div className="t-brief">
      {bullets ? (
        <ul>
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <p className="t-empty">No summary for this contract right now.</p>
      )}
      <p className="t-foot">AI summary of Manta&apos;s data. Not investment advice.</p>
    </div>
  );
}

/** Watch and alerts for the contract in focus. Signed out, a link to sign in on the account page:
 * Clerk's sign-in button can't render on the server inside the terminal's live-data wrapper. */
export async function AlertsPanel({ venue, id }: { venue: string; id: string }) {
  const { userId } = await auth();
  if (!userId) {
    return (
      <p className="t-empty">
        <Link href="/account">Sign in</Link> to watch this contract or get an email when its price,
        spread or depth crosses a level you set.
      </p>
    );
  }
  const [watched, alerts, paired] = await Promise.all([
    isWatched(userId, venue, id),
    getAlerts(userId, venue, id),
    isPaired(venue, id),
  ]);
  return (
    <section className="watch">
      <form action={toggleWatch.bind(null, venue, id)}>
        <button type="submit">{watched ? "★ Watching" : "☆ Watch"}</button>{" "}
        <Link href="/account" className="small">
          Your watchlist and alerts
        </Link>
      </form>
      {alerts.length > 0 && (
        <ul className="alert-list small">
          {alerts.map((a) => (
            <li key={a.alertId}>
              {describe(a.kind, a.threshold)}
              {a.met && <b> · met now</b>}
              <form action={deleteAlert.bind(null, a.alertId)}>
                <button type="submit" className="link-button" aria-label="Delete this alert">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <AlertForm venue={venue} id={id} paired={paired} />
    </section>
  );
}

/** Our fair value beside the midpoint, and how accurate it has been: Brier scores on the
 * same venue and family at the nearest time before the close, scored over whole closes. */
export async function FairPanel({ o, close, now }: { o: Row; close: number; now: number }) {
  const m = mid(o);
  const f = usableFair(o);
  if (!o.fairMethod || f === null || m === null) {
    return (
      <p className="t-empty">
        {o.fairMethod === "consensus-1"
          ? "Only one venue quotes this, so a fair value would just repeat its price."
          : "No fair value for this contract yet."}
      </p>
    );
  }
  const minutesLeft = (close - now) / 60_000;
  const horizon = [5, 60, 1440, 10080].reduce((b, h) =>
    Math.abs(Math.log(h / Math.max(minutesLeft, 1))) < Math.abs(Math.log(b / Math.max(minutesLeft, 1))) ? h : b,
  );
  const all = await eventScores();
  const s = score(all.filter((r) => r.venue === o.venue && r.family === o.family && r.horizon === horizon));
  const label = { 5: "5 minutes", 60: "1 hour", 1440: "1 day", 10080: "1 week" }[horizon];
  const d = Math.round((f - m) * 1000) / 10;
  const verdict =
    s.diff === null
      ? "Too few settled closes to say how accurate this has been."
      : s.diff[1] < 0
        ? "The fair value has been measurably more accurate than the market's price here."
        : s.diff[0] > 0
          ? "The fair value has been measurably less accurate than the market's price here."
          : "No measurable difference in accuracy between the fair value and the market's price here.";
  return (
    <div className="t-fair">
      <div className="t-fair-figs num">
        <div>
          <span>Mid</span>
          <b>{pct(m)}</b>
        </div>
        <div>
          <span>Fair</span>
          <b className="t-mint">{pct(f)}</b>
        </div>
        <div>
          <span>Gap</span>
          <b className={d > 0 ? "up" : d < 0 ? "down" : ""}>
            {d > 0 ? "+" : d < 0 ? "−" : ""}
            {Math.abs(d).toFixed(1)} pts
          </b>
        </div>
      </div>
      <p className="t-note">{METHODS[o.fairMethod].name}.</p>
      <div className="t-record num">
        <span className="t-dim">
          Accuracy, {label} before the close, this family on {o.venue === "kalshi" ? "Kalshi" : "Polymarket"}
        </span>
        <div>
          Error score, lower is better: market <b>{s.venueF?.toFixed(3) ?? "–"}</b> · fair{" "}
          <b className="t-mint">{s.fair?.toFixed(3) ?? "–"}</b>{" "}
          <span className="t-dim">(Brier score, the average squared miss, over {s.fairEvents} settled closes)</span>
        </div>
        <p>{verdict}</p>
      </div>
    </div>
  );
}

/** Every outcome of the event in focus, with its price, spread and fair-value gap. On a long
 * ladder, strikes priced under 2% or over 98% say little: the ones in play are listed (and the one
 * in focus), the rest counted. A row links to the terminal on that outcome, or to `href`'s target. */
export function BoardPanel({
  e,
  focus,
  layout = "market",
  href,
}: {
  e: Event;
  focus: string;
  layout?: string;
  href?: (x: Row) => string;
}) {
  const to = href ?? ((x: Row) => `/terminal?m=${encodeURIComponent(`${x.venue}:${x.id}`)}&layout=${layout}`);
  const inPlay = (x: Row) =>
    x.id === focus || e.outcomes.length <= 8 || ((mid(x) ?? 0) > 0.02 && (mid(x) ?? 1) < 0.98);
  const listed = e.outcomes.filter(inPlay);
  return (
    <>
    <table className="t-table num">
      <thead>
        <tr>
          <th>Outcome</th>
          <th>Bid</th>
          <th>Ask</th>
          <th>Mid</th>
          <th>Fair</th>
          <th>Gap</th>
          <th>Vol</th>
        </tr>
      </thead>
      <tbody>
        {listed.map((x) => {
          const m = mid(x);
          const f = usableFair(x);
          const g = f !== null && m !== null ? Math.round((f - m) * 1000) / 10 : null;
          return (
            <tr key={x.id} className={x.id === focus ? "on" : undefined}>
              <td>
                <Link href={to(x)} scroll={false}>
                  {outcomeLabel(x)}
                </Link>
              </td>
              <td>{cents(x.bid)}</td>
              <td>{cents(x.ask)}</td>
              <td>{pct(m)}</td>
              <td className="t-mint">{pct(f)}</td>
              <td className={g === null ? "" : g >= 3 ? "up" : g <= -3 ? "down" : "t-dim"}>
                {g === null ? "–" : `${g > 0 ? "+" : g < 0 ? "−" : ""}${Math.abs(g).toFixed(1)}`}
              </td>
              <td className="t-dim">{x.volume >= 1000 ? `${Math.round(x.volume / 1000)}k` : Math.round(x.volume)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {listed.length < e.outcomes.length && (
      <p className="t-note">
        {e.outcomes.length - listed.length} more priced under 2% or over 98% are hidden.
      </p>
    )}
    </>
  );
}

/** Pairs of the same question on both venues, best cross first. For pairs whose prices cross,
 * walk both live books after both taker fees to show how many contracts are actually tradable. */
export async function ArbPanel({ events, layout }: { events: Event[]; layout: string }) {
  const { pairs } = await getPairs();
  const row = new Map(events.flatMap((e) => e.outcomes.map((o) => [`${o.venue}:${o.id}`, o] as const)));
  const ranked = pairs
    .map((p) => ({ p, x: crossed(p) }))
    .sort((a, b) => (b.x?.cents ?? -99) - (a.x?.cents ?? -99))
    .slice(0, 12);
  const sized = await Promise.all(ranked.map(({ p, x }) => size(p, x, row)));
  return (
    <table className="t-table num">
      <thead>
        <tr>
          <th>Question</th>
          <th>Kalshi</th>
          <th>Poly</th>
          <th>Cross</th>
          <th>After fees</th>
          <th>Tradable</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map(({ p, x }, i) => {
          const k = p.kalshi.ids[0];
          const z = sized[i];
          return (
            <tr key={`${p.topic}/${p.question}`}>
              <td>
                <Link href={`/terminal?m=${encodeURIComponent(`kalshi:${k}`)}&layout=${layout}`} scroll={false}>
                  {p.question}
                </Link>
                {p.kind !== "same" && <span className="t-dim"> · {p.kind === "bundle" ? "bundle" : "near"}</span>}
              </td>
              <td>
                {cents(p.kalshi.bid)}/{cents(p.kalshi.ask)}
              </td>
              <td>
                {cents(p.poly.bid)}/{cents(p.poly.ask)}
              </td>
              <td>{x ? `${x.cents.toFixed(1)}¢` : <span className="t-dim">none</span>}</td>
              <td className={x?.net && x.net > 0 ? "up" : x ? "down" : "t-dim"}>
                {x?.net == null ? "–" : `${x.net > 0 ? "+" : "−"}${Math.abs(x.net).toFixed(2)}¢`}
              </td>
              <td>{z}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** For a crossing single-contract pair: walk both live books; "120 × +$2.40" or why not. */
async function size(p: Pair, x: ReturnType<typeof crossed>, row: Map<string, Row>): Promise<React.ReactNode> {
  if (!x || x.net === null || x.net <= 0) return <span className="t-dim">–</span>;
  if (p.kind === "bundle" || p.poly.ids.length !== 1) return <span className="t-dim">best level only</span>;
  const k = row.get(`kalshi:${p.kalshi.ids[0]}`);
  const q = row.get(`polymarket:${p.poly.ids[0]}`);
  if (!k || !q) return <span className="t-dim">–</span>;
  const tok = await polyTokens(q.event, q.id);
  const [kb, qb] = await Promise.all([kalshiBook(k.id), tok ? polyBook(tok[0]) : null]);
  if (!kb || !qb) return <span className="t-dim">book unavailable</span>;
  const kf = (n: number, pr: number) => (k.feeTaker === null ? 0 : kalshiFee(k.feeTaker, n, pr));
  const qf = (n: number, pr: number) => (q.feeTaker === null ? 0 : polymarketFee(q.feeTaker, n, pr));
  const fill = x.buy === "Kalshi" ? arbitrage(kb.asks, qb.bids, kf, qf) : arbitrage(qb.asks, kb.bids, qf, kf);
  if (!fill) return <span className="t-dim">gone in the live books</span>;
  return (
    <span className="up">
      {Math.floor(fill.contracts).toLocaleString("en-US")} × +${fill.profit.toFixed(2)}
    </span>
  );
}

/** The implied distribution of the event in focus, when it is a ladder Manta reads one from. */
export async function DistPanel({ event }: { event: string }) {
  const d = (await getDistributions()).find((x) => x.event === event);
  if (!d) return <p className="t-empty">No distribution for this market: it isn&apos;t a ladder of strikes.</p>;
  return (
    <div className="t-dist">
      <p className="t-note num">
        Median <b>{fmtValue(d.family, d.median)}</b> · even odds {fmtValue(d.family, d.q25)} – {fmtValue(d.family, d.q75)}
        {d.vol !== null && (
          <>
            {" "}
            · implied vol {Math.round(d.vol * 100)}%{d.deribitVol !== null && ` (Deribit ${Math.round(d.deribitVol * 100)}%)`}
          </>
        )}
      </p>
      <DistChart d={d} />
    </div>
  );
}

/** The five newest official news items (lib/news.ts), each with how long ago and how the books
 * moved after it against the 30 minutes before. Nothing at all if the replay server is down. */
async function RecentNews({ now }: { now: number }) {
  const n = await getNews().catch((e) => {
    console.error(e);
    return null;
  });
  if (!n) return null;
  const latest = joined(n).slice(0, 5);
  if (latest.length === 0) return null;
  const ago = (t: number) => {
    const m = Math.max(0, (now - t) / 60_000);
    return `${m < 60 ? `${Math.round(m)} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`} ago`;
  };
  return (
    <>
      <p className="t-dim small">Official news</p>
      <ul className="t-cal">
        {latest.map(({ it, t, move }) => (
          <li key={it.key}>
            <Link href={`/insights/news/${it.key}`}>
              <span className="t-cal-when num">
                <b>{ago(t)}</b>
                <span className="t-dim">{utc(t)}</span>
              </span>
              <span className="t-cal-q">
                <span className="t-dim">{SOURCES[it.source]?.short ?? it.source}</span> {it.title}
              </span>
              <span className="t-cal-top num t-dim">
                {move?.release ? "release" : move && move.contracts > 0 ? beyondText(move) : "pending"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="t-dim small">
        <Link href="/insights/news">Every item, with its timing →</Link>
      </p>
    </>
  );
}

/** Scheduled releases: economics and financial events by when their contracts close (a release
 * comes a minute after its contracts close), with the market's current favourite. */
export function CalendarPanel({ events, now, layout }: { events: Event[]; now: number; layout: string }) {
  const upcoming = events
    .filter((e) => e.category === "Economics" && e.close > now && e.close - now < 45 * 86_400_000)
    .sort((a, b) => a.close - b.close)
    .slice(0, 20);
  const left = (t: number) => {
    const h = (t - now) / 3_600_000;
    return h < 24 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
  };
  // Past releases: how contracts reacted, measured from our recordings (event response); then the
  // latest official news (tool 16), which arrives unscheduled.
  const past = (
    <>
      <p className="t-dim small">
        <Link href="/insights#release">Past releases: how markets reacted →</Link>
      </p>
      <Suspense fallback={null}>
        <RecentNews now={now} />
      </Suspense>
    </>
  );
  if (!upcoming.length)
    return (
      <>
        <p className="t-empty">No releases in the next 45 days.</p>
        {past}
      </>
    );
  return (
    <>
      <ul className="t-cal">
        {upcoming.map((e) => {
          const top = featured(e.outcomes, 1)[0];
          return (
            <li key={`${e.venue}/${e.event}`}>
              <Link href={`/terminal?m=${encodeURIComponent(`${e.venue}:${top?.id ?? e.outcomes[0].id}`)}&layout=${layout}`} scroll={false}>
                <span className="t-cal-when num">
                  <b>{left(e.close)}</b>
                  <span className="t-dim">{utc(e.close)}</span>
                </span>
                <span className="t-cal-q">
                  <VenueLogo venue={e.venue} height={10} compact />
                  {e.question}
                </span>
                <span className="t-cal-top num">
                  {top && (
                    <>
                      <span className="t-dim">{outcomeLabel(top)}</span> {pct(mid(top))}
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {past}
    </>
  );
}

/** The same question on the other venue, when the contract in focus is one side of a pair
 * (lib/compare.ts): its bid and ask there, beside this venue's. Nothing when it isn't paired. */
export async function PairPanel({ o }: { o: Row }) {
  const { pairs } = await getPairs();
  const p = pairs.find((x) => (o.venue === "kalshi" ? x.kalshi.ids : x.poly.ids).includes(o.id));
  if (!p) return null;
  const here = o.venue === "kalshi" ? p.kalshi : p.poly;
  const there = o.venue === "kalshi" ? p.poly : p.kalshi;
  const name = o.venue === "kalshi" ? "Polymarket" : "Kalshi";
  const m = (s: { bid: number | null; ask: number | null }) =>
    s.bid !== null && s.ask !== null ? (s.bid + s.ask) / 2 : null;
  return (
    <div className="t-fair">
      <div className="t-fair-figs num">
        <div>
          <span>Here, bid / ask</span>
          <b>
            {cents(here.bid)} / {cents(here.ask)}
          </b>
        </div>
        <div>
          <span>{name}, bid / ask</span>
          <b>
            {cents(there.bid)} / {cents(there.ask)}
          </b>
        </div>
        <div>
          <span>{name} mid</span>
          <b>{pct(m(there))}</b>
        </div>
      </div>
      <p className="t-note">
        {p.question}
        {p.kind === "bundle" && `: on ${name}, the sum of ${there.ids.length} range contracts`}
        {p.kind === "near" && ". Close, not identical: the two venues settle on slightly different numbers"}
        . <Link href="/insights#crossing">Every pair</Link>
      </p>
    </div>
  );
}

/** Kalshi's Bitcoin ladder for the event in focus, strike by strike, against Manta's fair value
 * from Deribit's options (the snapshotter's once-a-minute readings, lib/queries.ts getBoard).
 * Nothing for other markets. */
export async function LadderPanel({ e }: { e: Event }) {
  if (e.venue !== "kalshi" || (e.family !== "KXBTCD" && e.family !== "KXBTC")) return null;
  const board = await getBoard();
  const quotes = board?.quotes.filter((q) => q.series === e.family && q.close === e.close) ?? [];
  if (!quotes.length) return null;
  return (
    <div className="pad">
      <FairLadder
        title={e.family === "KXBTCD" ? "Pays $1 if BTC is above" : "Pays $1 if BTC is between"}
        quotes={quotes}
      />
      <p className="t-note">
        Grey bar: Kalshi&apos;s bid to ask. Mint tick: Manta&apos;s fair value. Shaded: fair value
        outside the bar, a gap wider than the spread.
      </p>
    </div>
  );
}
