import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import AlertForm from "@/components/AlertForm";
import AutoRefresh from "@/components/AutoRefresh";
import PriceChart from "@/components/PriceChart";
import { getAlerts, isPaired, isWatched } from "@/lib/account";
import { deleteAlert, toggleWatch } from "@/lib/accountActions";
import { describe } from "@/lib/alerts";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getMarket, type Row } from "@/lib/screener";
import { type Cost, kalshiFee, polymarketFee, walk } from "@/lib/cost";
import { METHODS, SETTLEMENT, summary } from "@/lib/settlement";
import {
  type Book,
  kalshiBook,
  kalshiHistory,
  kalshiRules,
  kalshiTrades,
  polyBook,
  polyHistory,
  polyRules,
  polyTokens,
  polyTrades,
  type Range,
  type Trade,
} from "@/lib/venues";

export const metadata = { title: "Manta: contract" };

const RANGES: Range[] = ["6h", "24h", "7d"];

export default function ContractPage({
  params,
  searchParams,
}: PageProps<"/contract/[venue]/[id]">) {
  return (
    <div className="wide">
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Contract params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Cents with at most one decimal: 0.42 → "42¢", 0.918 → "91.8¢". */
const cents = (p: number | null | undefined) =>
  p === null || p === undefined ? "–" : `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });

/** Time to close from the listing's time: "38 min", "5 h 12 min", "3 days". */
function until(close: number, at: number): string {
  const m = Math.round((close - at) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.floor(m / 60)} h ${m % 60} min`;
  return `in ${Math.round(m / 1440)} days`;
}

async function Contract({
  params,
  searchParams,
}: Pick<PageProps<"/contract/[venue]/[id]">, "params" | "searchParams">) {
  await connection(); // request time only: the build never queries the database
  const { venue, id: rawId } = await params;
  const sp = await searchParams;
  const range = RANGES.find((r) => r === sp.range) ?? "24h";
  const side = sp.side === "sell" ? "sell" : "buy";
  const n = Math.min(Math.max(Number.parseInt(String(sp.n ?? "100"), 10) || 100, 1), 1_000_000);
  if (venue !== "kalshi" && venue !== "polymarket") notFound();
  const id = decodeURIComponent(rawId);
  const got = await getMarket(venue, id);
  if (!got) {
    return (
      <>
        <h1>Not listed</h1>
        <p className="muted">
          This contract isn&apos;t open on {venue === "kalshi" ? "Kalshi" : "Polymarket"} among the
          families Manta covers: it has closed, or it was never covered.{" "}
          <Link href="/screener">Back to the screener</Link>.
        </p>
      </>
    );
  }
  const { row: c, tracked, at } = got;
  const family = FAMILIES.find((f) => f.family === c.family);
  const s = SETTLEMENT[c.family];
  const venueName = venue === "kalshi" ? "Kalshi" : "Polymarket";
  const tokens = venue === "polymarket" ? await polyTokens(c.event, c.id) : null;

  return (
    <>
      <AutoRefresh seconds={10} />
      <p className="small">
        <Link href={`/screener?family=${c.family}`}>{family?.name ?? c.family}</Link> · {venueName}{" "}
        · <span className="num">{venue === "kalshi" ? c.id : c.event}</span>
      </p>
      <h1>{summary(c)}</h1>
      <p className="muted">
        {c.title} Closes {utc(c.close)} ({until(c.close, at)}).
        {s && <> Settles on {s.settles}.</>}
      </p>
      <Quote c={c} />
      <p className="small">
        Bid and ask from {venueName}&apos;s market list at {utc(at)}; the order book below is live.
      </p>
      {c.fairMethod && (
        <p className="small">
          <b>Fair value: {METHODS[c.fairMethod].name}.</b> {METHODS[c.fairMethod].explain}
          {c.bid !== null &&
            c.ask !== null &&
            c.fair !== null &&
            c.fairMethod !== "consensus-1" && (
              <>
                {" "}
                It is {Math.abs(Math.round((c.fair - (c.bid + c.ask) / 2) * 1000) / 10)}¢{" "}
                {c.fair > (c.bid + c.ask) / 2 ? "above" : "below"} the midpoint. Not investment
                advice.
              </>
            )}
        </p>
      )}
      {tracked && (
        <p className="small">
          Our options-implied fair value for this contract, minute by minute:{" "}
          <Link href={`/c/${c.id}`}>BTC tracker →</Link>
        </p>
      )}

      <Suspense fallback={null}>
        <Watch venue={venue} id={c.id} />
      </Suspense>

      <h2>Price</h2>
      <p className="pills small">
        {RANGES.map((r) =>
          r === range ? (
            <b key={r}>{r}</b>
          ) : (
            <Link key={r} href={`?range=${r}`} scroll={false}>
              {r}
            </Link>
          ),
        )}
      </p>
      <Suspense fallback={<p className="muted">Loading the chart…</p>}>
        <Chart c={c} range={range} yesToken={tokens?.[0]} />
      </Suspense>

      <h2>Cost to trade</h2>
      <Suspense fallback={<p className="muted">Loading the order book…</p>}>
        <CostSection c={c} yesToken={tokens?.[0]} side={side} n={n} range={range} />
      </Suspense>

      <div className="columns">
        <section>
          <h2>Order book</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <BookSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>
        <section>
          <h2>Recent trades</h2>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <TradesSection c={c} yesToken={tokens?.[0]} />
          </Suspense>
        </section>
      </div>

      <h2>Settlement rules</h2>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <RulesSection c={c} />
      </Suspense>
    </>
  );
}

/** Watch and alerts for the signed-in user (lib/account.ts); a sign-in prompt otherwise. */
async function Watch({ venue, id }: { venue: string; id: string }) {
  const { userId } = await auth();
  if (!userId) {
    return (
      <p className="small">
        <SignInButton mode="modal">
          <button type="button" className="link-button">
            Sign in
          </button>
        </SignInButton>{" "}
        to watch this contract or get an email alert when it moves.
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

function Quote({ c }: { c: Row }) {
  const spread = c.bid !== null && c.ask !== null ? c.ask - c.bid : null;
  return (
    <div className="stats">
      <div>
        <span>Bid</span>
        <b className="num">{cents(c.bid)}</b>
      </div>
      <div>
        <span>Ask</span>
        <b className="num">{cents(c.ask)}</b>
      </div>
      <div>
        <span>Spread</span>
        <b className="num">{cents(spread)}</b>
      </div>
      {c.fair !== null && (
        <div>
          <span>Fair value</span>
          <b className="num">{cents(c.fair)}</b>
        </div>
      )}
      <div>
        <span>Last trade</span>
        <b className="num">{cents(c.last)}</b>
      </div>
      <div>
        <span>Volume, 24 h</span>
        <b className="num">
          {c.volumeUnit === "usd" ? `$${qty(c.volume)}` : `${qty(c.volume)} contracts`}
        </b>
      </div>
      {c.openInterest !== null && (
        <div>
          <span>Open interest</span>
          <b className="num">{qty(c.openInterest)}</b>
        </div>
      )}
    </div>
  );
}

const unavailable = (what: string, venue: string) => (
  <p className="muted">
    {what} unavailable right now: {venue === "kalshi" ? "Kalshi" : "Polymarket"} didn&apos;t answer.
  </p>
);

async function Chart({ c, range, yesToken }: { c: Row; range: Range; yesToken?: string }) {
  const points =
    c.venue === "kalshi"
      ? await kalshiHistory(c.family, c.id, range)
      : yesToken
        ? await polyHistory(yesToken, range)
        : null;
  if (!points) return unavailable("Price history", c.venue);
  if (points.length < 2) return <p className="muted">Not enough history in this range yet.</p>;
  return <PriceChart points={points} venue={c.venue} days={range === "7d"} />;
}

async function BookSection({ c, yesToken }: { c: Row; yesToken?: string }) {
  const book: Book | null =
    c.venue === "kalshi" ? await kalshiBook(c.id) : yesToken ? await polyBook(yesToken) : null;
  if (!book) return unavailable("The order book", c.venue);
  if (book.bids.length === 0 && book.asks.length === 0) {
    return <p className="muted">No orders on either side.</p>;
  }
  // The best 10 levels each side are shown; the calculator above walks up to 50.
  const shown = { bids: book.bids.slice(0, 10), asks: book.asks.slice(0, 10) };
  const max = Math.max(...shown.bids.map((l) => l.size), ...shown.asks.map((l) => l.size));
  const bar = (size: number) => ({ "--w": `${(size / max) * 100}%` }) as React.CSSProperties;
  return (
    <>
      <div className="table-wrap">
        <table className="book">
          <thead>
            <tr>
              <th>Price</th>
              <th>Contracts</th>
            </tr>
          </thead>
          <tbody>
            {[...shown.asks].reverse().map((l) => (
              <tr key={`a${l.price}`} className="ask">
                <td className="num">Ask {cents(l.price)}</td>
                <td className="num level" style={bar(l.size)}>
                  {qty(l.size)}
                </td>
              </tr>
            ))}
            <tr className="mid">
              <td colSpan={2} className="small">
                spread{" "}
                {book.bids[0] && book.asks[0]
                  ? cents(book.asks[0].price - book.bids[0].price)
                  : "–"}
              </td>
            </tr>
            {shown.bids.map((l) => (
              <tr key={`b${l.price}`} className="bid">
                <td className="num">Bid {cents(l.price)}</td>
                <td className="num level" style={bar(l.size)}>
                  {qty(l.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        The best {shown.asks.length} asks and {shown.bids.length} bids for &ldquo;yes&rdquo;, live
        within seconds.
        {c.venue === "kalshi" &&
          " Kalshi lists bids for “yes” and for “no”; a “no” bid at 26¢ is shown as a “yes” ask at 74¢."}
      </p>
    </>
  );
}

const usd = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd4 = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

async function CostSection({
  c,
  yesToken,
  side,
  n,
  range,
}: {
  c: Row;
  yesToken?: string;
  side: "buy" | "sell";
  n: number;
  range: Range;
}) {
  const book: Book | null =
    c.venue === "kalshi" ? await kalshiBook(c.id) : yesToken ? await polyBook(yesToken) : null;
  const rate = c.feeTaker;
  const fee = (q: number, p: number) =>
    rate === null ? 0 : c.venue === "kalshi" ? kalshiFee(rate, q, p) : polymarketFee(rate, q, p);
  const cost = book ? walk(side, n, side === "buy" ? book.asks : book.bids, fee) : null;
  return (
    <>
      {/* A plain GET form: the result is a URL that can be shared. */}
      <form className="filters" action="">
        <label>
          I want to
          <select name="side" defaultValue={side}>
            <option value="buy">buy “yes”</option>
            <option value="sell">sell “yes”</option>
          </select>
        </label>
        <label>
          Contracts
          <input name="n" type="number" min={1} max={1000000} defaultValue={n} />
        </label>
        {range !== "24h" && <input type="hidden" name="range" value={range} />}
        <button type="submit">Calculate</button>
      </form>
      {!book ? (
        unavailable("The order book", c.venue)
      ) : !cost ? (
        <p className="muted">No {side === "buy" ? "asks" : "bids"} to trade against.</p>
      ) : (
        <CostResult c={c} cost={cost} rate={rate} />
      )}
    </>
  );
}

function CostResult({ c, cost, rate }: { c: Row; cost: Cost; rate: number | null }) {
  const buy = cost.side === "buy";
  const fairUsable = c.fair !== null && c.fairMethod !== "consensus-1";
  // What the filled contracts are worth at our fair value, against what the trade pays or gets.
  const atFair = fairUsable ? cost.filled * c.fair! : null;
  const vsFair = atFair === null ? null : buy ? atFair - cost.total : cost.total - atFair;
  return (
    <>
      <div className="stats">
        <div>
          <span>{buy ? "You pay, all in" : "You receive, all in"}</span>
          <b className="num">{usd(cost.total)}</b>
        </div>
        <div>
          <span>Per contract</span>
          <b className="num">{cents(cost.perContract)}</b>
        </div>
        <div>
          <span>Average price</span>
          <b className="num">{cents(cost.average)}</b>
        </div>
        <div>
          <span>Slippage</span>
          <b className="num">{cents(cost.slippage)}</b>
        </div>
        <div>
          <span>Fee</span>
          <b className="num">{rate === null ? "unknown" : usd4(cost.fee)}</b>
        </div>
      </div>
      <p className="small">
        {cost.filled < cost.wanted ? (
          <span className="status-bad">
            Only {qty(cost.filled)} of {qty(cost.wanted)} contracts are on offer in the best{" "}
            {cost.fills.length} levels.{" "}
          </span>
        ) : null}
        {buy ? "Buying" : "Selling"} {qty(cost.filled)} contracts at once takes{" "}
        {cost.fills.length === 1 ? "one price level" : `${cost.fills.length} price levels`}, from{" "}
        {cents(cost.best)} to {cents(cost.fills.at(-1)!.price)}: {usd(cost.value)}{" "}
        {buy ? "paid" : "received"} before fees. Slippage is how much worse the average is than the
        best price: {usd(cost.slippage * cost.filled)} in all.{" "}
        {rate === null
          ? "This market's fee type isn't one we model, so fees are left out."
          : c.venue === "kalshi"
            ? `Kalshi's taker fee is ${rate} × contracts × price × (1 − price), rounded up to $0.0001 per fill${c.feeMaker ? `; a resting order that fills later pays a maker fee of ${c.feeMaker} instead` : "; resting orders pay no fee in this market"}.`
            : `Polymarket's taker fee is ${rate} × contracts × price × (1 − price); resting orders pay none.`}
        {vsFair !== null && (
          <>
            {" "}
            At our fair value of {cents(c.fair)}, these contracts are worth {usd(atFair!)}: the
            trade is {usd(Math.abs(vsFair))} {vsFair >= 0 ? "better" : "worse"} than fair, all costs
            included. Not investment advice.
          </>
        )}
      </p>
    </>
  );
}

async function TradesSection({ c, yesToken }: { c: Row; yesToken?: string }) {
  const trades: Trade[] | null =
    c.venue === "kalshi"
      ? await kalshiTrades(c.id)
      : yesToken
        ? await polyTrades(c.id, yesToken)
        : null;
  if (!trades) return unavailable("Trades", c.venue);
  if (trades.length === 0) return <p className="muted">No trades yet.</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th style={{ textAlign: "left" }}>Side</th>
              <th>Price</th>
              <th>Contracts</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={`${t.t}/${i}`}>
                <td className="num">
                  {new Date(t.t).toISOString().slice(5, 19).replace("T", " ")}
                </td>
                <td style={{ textAlign: "left" }}>{t.side === "buy" ? "buy yes" : "sell yes"}</td>
                <td className="num">{cents(t.price)}</td>
                <td className="num">{qty(t.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        {c.venue === "kalshi"
          ? "The side is the trader who crossed the spread: “buy yes” took an ask."
          : "The side is as Polymarket's trade feed reports it. Trades in the “no” token are shown in “yes” terms."}
      </p>
    </>
  );
}

async function RulesSection({ c }: { c: Row }) {
  const rules = c.venue === "kalshi" ? await kalshiRules(c.id) : await polyRules(c.event);
  if (!rules) return unavailable("The rules", c.venue);
  return (
    <blockquote className="rules">
      {rules.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <footer className="small">— {rules.source}</footer>
    </blockquote>
  );
}
