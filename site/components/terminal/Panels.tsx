// The terminal's server-rendered panels (fair value, every outcome, arbitrage, distribution,
// catalysts, alerts): used by /terminal and by the home page's demo of it.
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Watch } from "@/components/ContractSections";
import DistChart from "@/components/DistChart";
import { arbitrage } from "@/lib/arb";
import { crossed, getPairs, type Pair } from "@/lib/compare";
import { kalshiFee, polymarketFee } from "@/lib/cost";
import { fmtValue, getDistributions } from "@/lib/distributions";
import { type Event } from "@/lib/events";
import { utc } from "@/lib/format";
import { featured, mid, outcomeLabel, usableFair } from "@/lib/outcomes";
import { score } from "@/lib/scoring";
import { type Row } from "@/lib/screener";
import { METHODS } from "@/lib/settlement";
import { eventScores } from "@/lib/stats";
import { kalshiBook, polyBook, polyTokens } from "@/lib/venues";


const pct = (p: number | null) => (p === null ? "–" : `${(Math.round(p * 1000) / 10).toFixed(1)}%`);
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

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
  return <Watch venue={venue} id={id} />;
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
          Brier: market <b>{s.venueF?.toFixed(4) ?? "–"}</b> · fair <b className="t-mint">{s.fair?.toFixed(4) ?? "–"}</b>{" "}
          <span className="t-dim">({s.fairEvents} closes; lower is better)</span>
        </div>
        <p>{verdict}</p>
      </div>
    </div>
  );
}

/** Every outcome of the event in focus, with its price, spread and fair-value gap. */
export function BoardPanel({ e, focus, layout }: { e: Event; focus: string; layout: string }) {
  return (
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
        {e.outcomes.map((x) => {
          const m = mid(x);
          const f = usableFair(x);
          const g = f !== null && m !== null ? Math.round((f - m) * 1000) / 10 : null;
          return (
            <tr key={x.id} className={x.id === focus ? "on" : undefined}>
              <td>
                <Link href={`/terminal?m=${encodeURIComponent(`${x.venue}:${x.id}`)}&layout=${layout}`} scroll={false}>
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
  // Past releases: how contracts reacted, measured from our recordings (event response).
  const past = (
    <p className="t-dim small">
      <Link href="/events">Past releases: how markets reacted →</Link>
    </p>
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
                  <span className={`t-venue ${e.venue}`}>{e.venue === "kalshi" ? "K" : "P"}</span>
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
