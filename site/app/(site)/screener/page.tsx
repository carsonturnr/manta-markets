import Link from "next/link";
import { pct, ProbBar } from "@/components/EventCard";
import LiveForm from "@/components/LiveForm";
import { mid, outcomeLabel, usableFair } from "@/lib/outcomes";
import { connection } from "next/server";
import { Suspense } from "react";
import { type Category, FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { type Filters, PAGE, type Row, screen, SORTS, type Sort } from "@/lib/screener";
import { METHODS } from "@/lib/settlement";

export const metadata = { title: "Manta: screener" };

type Params = Record<string, string | string[] | undefined>;

export default function ScreenerPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Screener searchParams={searchParams} />
    </Suspense>
  );
}

const CATEGORIES: Category[] = ["Crypto", "Economics", "Financials"];
const FAMILY_NAME = new Map(FAMILIES.map((f) => [f.family, f.name]));

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The filters in the URL, each checked against what it may be; anything else is ignored. */
function parse(p: Params): Filters {
  const pick = <T extends string>(v: string, ok: readonly T[], dflt: T): T =>
    (ok as readonly string[]).includes(v) ? (v as T) : dflt;
  const page = Number.parseInt(one(p.page), 10);
  const spread = Number.parseInt(one(p.spread), 10);
  return {
    venue: pick(one(p.venue), ["kalshi", "polymarket"] as const, ""),
    category: pick(one(p.category), CATEGORIES, ""),
    family: FAMILY_NAME.has(one(p.family)) ? one(p.family) : "",
    closes: pick(one(p.closes), ["1h", "24h", "7d"] as const, ""),
    traded: one(p.traded) === "1",
    oneSided: one(p.all) === "1",
    spread: [1, 2, 5, 10].includes(spread) ? spread : 0,
    q: one(p.q).trim().slice(0, 60),
    sort: pick(one(p.sort), SORTS, "close"),
    desc: one(p.dir) === "desc",
    page: Number.isFinite(page) && page > 0 && page < 1000 ? page : 0,
  };
}

/** The URL for these filters with some changed; defaults are left out to keep links short. */
function href(f: Filters, change: Partial<Filters>): string {
  const g = { ...f, ...change };
  const q = new URLSearchParams();
  if (g.venue) q.set("venue", g.venue);
  if (g.category) q.set("category", g.category);
  if (g.family) q.set("family", g.family);
  if (g.closes) q.set("closes", g.closes);
  if (g.traded) q.set("traded", "1");
  if (g.oneSided) q.set("all", "1");
  if (g.spread) q.set("spread", String(g.spread));
  if (g.q) q.set("q", g.q);
  if (g.sort !== "close") q.set("sort", g.sort);
  if (g.desc) q.set("dir", "desc");
  if (g.page) q.set("page", String(g.page));
  const s = q.toString();
  return s ? `/screener?${s}` : "/screener";
}

async function Screener({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const f = parse(await searchParams);
  const { rows, total, at, ageS } = await screen(f);
  const pages = Math.ceil(total / PAGE);
  return (
    <div className="screener-layout">
      <aside className="panel">
        <header className="ph">
          <h2>Filters</h2>
          <Link href="/screener" className="right small">
            Reset
          </Link>
        </header>
        <Form f={f} />
      </aside>
      <section className="panel">
        <header className="ph">
          <h1 className="h2">Markets</h1>
          <span className="m3 num">
            {total.toLocaleString("en-US")} contracts match
            {at !== null && (
              <>
                {" "}
                · listing read {utc(at)}
                {ageS !== null && ageS > 180 && (
                  <span className="status-bad"> ({Math.round(ageS / 60)} min old)</span>
                )}
              </>
            )}
          </span>
          <span className="right m3">Prices for &ldquo;yes&rdquo;: 37¢ is a 37% chance</span>
        </header>
        {rows.length === 0 ? (
          <p className="muted pad">No contracts match these filters.</p>
        ) : (
          <Table rows={rows} f={f} at={at ?? 0} />
        )}
        {pages > 1 && (
          <p className="pager">
            {f.page > 0 && <Link href={href(f, { page: f.page - 1 })}>← previous</Link>}
            <span className="small">
              page {f.page + 1} of {pages}
            </span>
            {f.page + 1 < pages && <Link href={href(f, { page: f.page + 1 })}>next →</Link>}
          </p>
        )}
        <p className="note">
          Refreshed every minute from each venue&apos;s market list, which can trail the live order
          book by up to a minute. Volume is in each venue&apos;s own unit: contracts on Kalshi,
          dollars traded on Polymarket. Contracts quoted on one side only (mostly strikes far from
          the price) are hidden unless &ldquo;Include one-sided&rdquo; is ticked. Chance is the
          midpoint between bid and ask. Fair value is our reference price: from Deribit&apos;s
          options for Bitcoin and Ether, from both venues&apos; quotes elsewhere; none where only
          one venue quotes, since it would only repeat that venue&apos;s price. Gap is our estimate
          minus the chance, in points: positive (green) when fair value is above the midpoint. Size,
          last trade and open interest are on each contract&apos;s page. Not investment advice.
        </p>
      </section>
    </div>
  );
}

// A GET form that applies as it changes (components/LiveForm); the result is a URL that can be
// shared, and the Apply button still works without JavaScript.
function Form({ f }: { f: Filters }) {
  return (
    <LiveForm className="filters" action="/screener">
      <label>
        Venue
        <select name="venue" defaultValue={f.venue}>
          <option value="">All</option>
          <option value="kalshi">Kalshi</option>
          <option value="polymarket">Polymarket</option>
        </select>
      </label>
      <label>
        Category
        <select name="category" defaultValue={f.category}>
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Family
        <select name="family" defaultValue={f.family}>
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <optgroup key={c} label={c}>
              {FAMILIES.filter((x) => x.category === c && !x.note).map((x) => (
                <option key={x.family} value={x.family}>
                  {x.name} ({x.venue === "kalshi" ? "Kalshi" : "Polymarket"})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        Closes within
        <select name="closes" defaultValue={f.closes}>
          <option value="">Any time</option>
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
        </select>
      </label>
      <label>
        Spread at most
        <select name="spread" defaultValue={String(f.spread)}>
          <option value="0">Any</option>
          {[1, 2, 5, 10].map((s) => (
            <option key={s} value={s}>
              {s}¢
            </option>
          ))}
        </select>
      </label>
      <label>
        Search
        <input type="text" name="q" defaultValue={f.q} placeholder="e.g. 7,325 or KXFED" />
      </label>
      <label className="check">
        <input type="checkbox" name="traded" value="1" defaultChecked={f.traded} />
        Traded in 24 h
      </label>
      <label className="check">
        <input type="checkbox" name="all" value="1" defaultChecked={f.oneSided} />
        Include one-sided
      </label>
      {f.sort !== "close" && <input type="hidden" name="sort" value={f.sort} />}
      {f.desc && <input type="hidden" name="dir" value="desc" />}
      <noscript>
        <button type="submit">Apply</button>
      </noscript>
      <Link href="/screener" className="small reset">
        Reset
      </Link>
    </LiveForm>
  );
}

/** Cents with at most one decimal: 0.42 → "42", 0.918 → "91.8", 0.001 → "0.1". */
function cents(p: number | null): string {
  if (p === null) return "–";
  return String(Math.round(p * 1000) / 10);
}

function volume(r: Row): string {
  if (r.volume === 0) return "–";
  const n =
    r.volume >= 1e6
      ? `${(r.volume / 1e6).toFixed(1)}M`
      : r.volume >= 1e3
        ? `${(r.volume / 1e3).toFixed(1)}k`
        : String(Math.round(r.volume));
  return r.volumeUnit === "usd" ? `$${n}` : n;
}

/** Fair value minus the midpoint, in cents: positive when fair is above it. None for one-venue
 * consensus, which is fitted to the very quotes it would be compared with. */
function edge(r: Row): number | null {
  if (r.fair === null || r.bid === null || r.ask === null || r.fairMethod === "consensus-1") {
    return null;
  }
  return Math.round((r.fair - (r.bid + r.ask) / 2) * 1000) / 10;
}

/** The edge as a chip: green when fair is above the midpoint, red when below. */
function Edge({ e }: { e: number | null }) {
  if (e === null) return <span className="m3">–</span>;
  const cls = e > 0 ? "edge up" : e < 0 ? "edge down" : "edge";
  return <span className={cls}>{e > 0 ? `+${e}` : e < 0 ? `−${-e}` : "0"}</span>;
}

/** Time to close from the listing's time: "38 min", "5 h 12 min", "3 d". */
function until(close: number, at: number): string {
  const m = Math.round((close - at) / 60_000);
  if (m < 1) return "closing";
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.round(m / 1440)} d`;
}

// A column header sorts by it; clicking the current sort flips its direction.
function Th({ f, s, children }: { f: Filters; s: Sort; children: React.ReactNode }) {
  const on = f.sort === s;
  return (
    <th aria-sort={on ? (f.desc ? "descending" : "ascending") : undefined}>
      <Link href={href(f, { sort: s, desc: on ? !f.desc : s !== "close", page: 0 })}>
        {children}
        {on ? (f.desc ? " ↓" : " ↑") : ""}
      </Link>
    </th>
  );
}

function Table({ rows, f, at }: { rows: Row[]; f: Filters; at: number }) {
  return (
    <div className="table-wrap screener-table">
      <table className="screener num">
        <thead>
          <tr>
            <th>Market</th>
            <th>Chance</th>
            <Th f={f} s="bid">
              Bid
            </Th>
            <Th f={f} s="ask">
              Ask
            </Th>
            <th title="Our fair value: from Deribit's options for Bitcoin and Ether, from both venues' quotes elsewhere">Fair value</th>
            <Th f={f} s="edge">
              Gap
            </Th>
            <Th f={f} s="spread">
              Spread
            </Th>
            <Th f={f} s="volume">
              Volume 24 h
            </Th>
            <Th f={f} s="close">
              Closes
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.venue}/${r.id}`}>
              <td className="contract" title={r.title}>
                <Link href={`/m/${r.venue}/${encodeURIComponent(r.event)}?o=${encodeURIComponent(r.id)}`}>
                  {outcomeLabel(r)}
                </Link>
                <span className="sub">
                  <span className={`venue ${r.venue}`}>{r.venue === "kalshi" ? "Kalshi" : "Polymarket"}</span>{" "}
                  · {FAMILY_NAME.get(r.family) ?? r.family}
                </span>
              </td>
              <td>
                <span className="chance">
                  <ProbBar o={r} />
                  <b>{pct(mid(r))}</b>
                </span>
              </td>
              <td className="m2">{cents(r.bid)}</td>
              <td className="m2">{cents(r.ask)}</td>
              <td title={r.fairMethod ? METHODS[r.fairMethod].name : undefined}>
                {usableFair(r) === null ? (
                  <span className="m3">–</span>
                ) : (
                  pct(usableFair(r))
                )}
              </td>
              <td>
                <Edge e={edge(r)} />
              </td>
              <td>{r.bid !== null && r.ask !== null ? cents(r.ask - r.bid) : "–"}</td>
              <td>{volume(r)}</td>
              <td className="m2" title={utc(r.close)}>
                {until(r.close, at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
