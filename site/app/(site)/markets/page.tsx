// Markets: every open question Manta covers on one page, one row per event (lib/events.ts
// getEvents()), busiest first. A row shows the event's most likely outcome, its volume and its
// close; opening it lists every outcome with price, spread, size, volume and the gap to fair
// value, each linking to its Market page. Server-rendered: the category, the search and the order
// are links and a GET form, so a view is a shareable URL. No pages to click through: a few hundred
// events fit on one page, where ~1,300 contracts did not.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProbBar } from "@/components/EventCard";
import LiveForm from "@/components/LiveForm";
import VenueLogo from "@/components/VenueLogo";
import { type Event, getEvents } from "@/lib/events";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { featured, mid, outcomeLabel } from "@/lib/outcomes";
import type { Row } from "@/lib/screener";

export const metadata = { title: "Manta: markets" };

type Params = Record<string, string | string[] | undefined>;

const CATEGORIES = ["Crypto", "Economics", "Financials"] as const;
const FAMILY_NAME = new Map(FAMILIES.map((f) => [f.family, f.name]));
const ORDERS = { volume: "Most traded", close: "Closing soonest" } as const;
type Order = keyof typeof ORDERS;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function MarketsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <h1>Markets</h1>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type View = { cat: string; q: string; order: Order };

function href(v: View, change: Partial<View>): string {
  const g = { ...v, ...change };
  const u = new URLSearchParams();
  if (g.cat) u.set("cat", g.cat);
  if (g.q) u.set("q", g.q);
  if (g.order !== "volume") u.set("order", g.order);
  const s = u.toString();
  return s ? `/markets?${s}` : "/markets";
}

/** Dollars traded in 24 hours, so the two venues sort together: Polymarket reports dollars,
 * Kalshi contracts (each worth about its price). */
const dollars = (r: Row) => (r.volumeUnit === "usd" ? r.volume : r.volume * (mid(r) ?? 0));

async function Markets({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const p = await searchParams;
  const v: View = {
    cat: CATEGORIES.find((c) => c === one(p.cat)) ?? "",
    q: one(p.q).trim().slice(0, 60),
    order: one(p.order) === "close" ? "close" : "volume",
  };
  const { events, at } = await getEvents();
  const q = v.q.toLowerCase();
  const shown = events
    .filter((e) => !v.cat || e.category === v.cat)
    .filter(
      (e) =>
        !q ||
        e.question.toLowerCase().includes(q) ||
        e.event.toLowerCase().includes(q) ||
        e.outcomes.some((o) => outcomeLabel(o).toLowerCase().includes(q)),
    )
    .map((e) => ({ e, usd: e.outcomes.reduce((s, o) => s + dollars(o), 0) }))
    .sort((a, b) => (v.order === "close" ? a.e.close - b.e.close : b.usd - a.usd));
  return (
    <>
      <div className="markets-bar">
        <nav className="chip-row" aria-label="Category">
          {(["", ...CATEGORIES] as const).map((c) => (
            <Link
              key={c}
              href={href(v, { cat: c })}
              className={c === v.cat ? "chip-link on" : "chip-link"}
              aria-current={c === v.cat ? "true" : undefined}
              scroll={false}
            >
              {c || "All"}
            </Link>
          ))}
        </nav>
        <nav className="chip-row" aria-label="Order">
          {(Object.keys(ORDERS) as Order[]).map((o) => (
            <Link
              key={o}
              href={href(v, { order: o })}
              className={o === v.order ? "chip-link on" : "chip-link"}
              aria-current={o === v.order ? "true" : undefined}
              scroll={false}
            >
              {ORDERS[o]}
            </Link>
          ))}
        </nav>
        <LiveForm className="markets-form" action="/markets">
          {v.cat && <input type="hidden" name="cat" value={v.cat} />}
          {v.order !== "volume" && <input type="hidden" name="order" value={v.order} />}
          <input
            type="text"
            enterKeyHint="search"
            name="q"
            defaultValue={v.q}
            placeholder="Search: bitcoin, CPI, Fed…"
            aria-label="Search markets"
          />
          <noscript>
            <button type="submit" className="btn btn-sm">
              Apply
            </button>
          </noscript>
        </LiveForm>
      </div>
      {shown.length === 0 ? (
        <p className="muted">
          Nothing matches. Try fewer words, or <Link href="/markets">see every market</Link>.
        </p>
      ) : (
        <div className="mkt-list">
          {/* Column headings once, instead of a label under every figure (wide screens only). */}
          <div className="mkt-head" aria-hidden="true">
            <span>Question</span>
            <span>
              Outcome · price, <i className="dot" /> fair value
            </span>
            <span>Traded 24 h</span>
            <span>Closes in</span>
          </div>
          {shown.map(({ e, usd }) => (
            <EventRow key={`${e.venue}/${e.event}`} e={e} usd={usd} at={at ?? 0} />
          ))}
        </div>
      )}
      <p className="note">
        Prices come from each venue&apos;s market list, refreshed every minute; it can trail the
        live order book by up to a minute, which each Market page shows. Contracts quoted on one
        side only (mostly strikes far from the price) are left out. Not investment advice.
      </p>
    </>
  );
}

/** Cents with at most one decimal: 0.42 → "42¢", 0.918 → "91.8¢". */
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

/** 1,234 → "1.2k", 25,000 → "25k", 397,040 → "397k", 2,500,000 → "2.5M". */
const short = (n: number) => {
  const [v, unit] = n >= 999_500 ? [n / 1e6, "M"] : n >= 999.5 ? [n / 1e3, "k"] : [n, ""];
  return `${v >= 100 || unit === "" ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
};

/** Fair value minus the midpoint, in cents: positive when fair value is above it. None for
 * one-venue consensus, which is fitted to the very quotes it would be compared with. */
function gap(r: Row): number | null {
  if (r.fair === null || r.bid === null || r.ask === null || r.fairMethod === "consensus-1") {
    return null;
  }
  return Math.round((r.fair - (r.bid + r.ask) / 2) * 1000) / 10;
}

function Gap({ g }: { g: number | null }) {
  if (g === null) return <span className="m3">–</span>;
  const cls = g > 0 ? "edge up" : g < 0 ? "edge down" : "edge";
  return <span className={cls}>{g > 0 ? `+${g}¢` : g < 0 ? `−${-g}¢` : "0¢"}</span>;
}

/** Time to close from the listing's time: "38 min", "5 h 12 min", "3 d". */
function until(close: number, at: number): string {
  const m = Math.round((close - at) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.round(m / 1440)} d`;
}

// Each column's one-line explanation, on hover or keyboard focus.
const HELP = {
  price: "Halfway between the best bid and ask: the market's price, read as a chance.",
  spread: "Best ask minus best bid: what buying and selling at once would cost. Smaller is cheaper.",
  size: "Contracts on offer at the best bid / best ask: how much trades at the shown price.",
  volume: "Traded in the last 24 hours: contracts on Kalshi, dollars on Polymarket.",
  gap: "Manta's fair value minus the price, in cents. Green: Manta's estimate is higher.",
};

function Th({ k, name }: { k: keyof typeof HELP; name: string }) {
  const tip = `help-${k}`;
  return (
    <th className="has-tip">
      <span tabIndex={0} aria-describedby={tip}>
        {name}
      </span>
      <span role="tooltip" id={tip} className="th-tip">
        {HELP[k]}
      </span>
    </th>
  );
}

/** One question: a summary line that opens to every outcome. */
function EventRow({ e, usd, at }: { e: Event; usd: number; at: number }) {
  const top = featured(e.outcomes, 1)[0];
  const link = (o: Row) => `/m/${o.venue}/${encodeURIComponent(o.event)}?o=${encodeURIComponent(o.id)}`;
  return (
    <details className="mkt-row">
      <summary>
        <span className="mkt-q">
          <b>{e.question}</b>
          <span className="sub">
            <VenueLogo venue={e.venue} /> · {FAMILY_NAME.get(e.family) ?? e.family} · {e.outcomes.length}{" "}
            {e.outcomes.length === 1 ? "outcome" : "outcomes"}
          </span>
        </span>
        {top && (
          <span className="mkt-top">
            <span className="sub">{outcomeLabel(top)}</span>
            <span className="chance">
              <ProbBar o={top} />
              <b>{cents(mid(top))}</b>
            </span>
          </span>
        )}
        <span className="mkt-fig num">
          <b>${short(usd)}</b>
          <span className="sub">traded 24 h</span>
        </span>
        <span className="mkt-fig num" title={utc(e.close)}>
          <b>{until(e.close, at)}</b>
          <span className="sub">to close</span>
        </span>
      </summary>
      <div className="table-wrap markets-table">
        <table className="screener num">
          <thead>
            <tr>
              <th>Outcome</th>
              <Th k="price" name="Price" />
              <Th k="spread" name="Spread" />
              <Th k="size" name="Size at best" />
              <Th k="volume" name="Volume 24 h" />
              <Th k="gap" name="Gap to fair value" />
            </tr>
          </thead>
          <tbody>
            {e.outcomes.map((o) => (
              <tr key={o.id}>
                <td className="contract">
                  <Link href={link(o)}>{outcomeLabel(o)}</Link>
                </td>
                <td>{cents(mid(o))}</td>
                <td>{o.bid !== null && o.ask !== null ? cents(o.ask - o.bid) : "–"}</td>
                <td className="m2">
                  {o.bidSize === null ? "–" : short(o.bidSize)} / {o.askSize === null ? "–" : short(o.askSize)}
                </td>
                <td>{o.volume === 0 ? "–" : o.volumeUnit === "usd" ? `$${short(o.volume)}` : short(o.volume)}</td>
                <td>
                  <Gap g={gap(o)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
