import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { type Category, FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { type Filters, PAGE, type Row, screen, SORTS, type Sort } from "@/lib/screener";

export const metadata = { title: "Manta: screener" };

type Params = Record<string, string | string[] | undefined>;

export default function ScreenerPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="wide">
      <h1>Screener</h1>
      <p className="muted">
        Every open contract Manta covers on Kalshi and Polymarket: crypto, economics and financials.
        Prices are in cents, the same as a probability in percent; the bid and ask are for
        &ldquo;yes&rdquo;. Refreshed every minute from each venue&apos;s market list, which can
        trail the live order book by up to a minute.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Screener searchParams={searchParams} />
      </Suspense>
    </div>
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
    <>
      <Form f={f} />
      <p className="small">
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
      </p>
      {rows.length === 0 ? (
        <p className="muted">No contracts match these filters.</p>
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
      <p className="small">
        Volume is in each venue&apos;s own unit: contracts on Kalshi, dollars traded on Polymarket.
        Contracts quoted on one side only (no bid or no ask, mostly strikes far from the price) are
        hidden unless &ldquo;Include one-sided&rdquo; is ticked. Open interest (contracts held,
        Kalshi only) is how many contracts are outstanding. Size is how many contracts are offered
        at the best bid × the best ask.
      </p>
    </>
  );
}

// A plain GET form: works without JavaScript, and the result is a URL that can be shared.
function Form({ f }: { f: Filters }) {
  return (
    <form className="filters" action="/screener">
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
        <input name="q" defaultValue={f.q} placeholder="e.g. 7,325 or KXFED" />
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
      <button type="submit">Apply</button>
      <Link href="/screener" className="small">
        Reset
      </Link>
    </form>
  );
}

/** Cents with at most one decimal: 0.42 → "42", 0.918 → "91.8", 0.001 → "0.1". */
function cents(p: number | null): string {
  if (p === null) return "–";
  return String(Math.round(p * 1000) / 10);
}

function size(n: number | null): string {
  if (n === null) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n));
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
    <div className="table-wrap">
      <table className="screener">
        <thead>
          <tr>
            <th>Contract</th>
            <th style={{ textAlign: "left" }}>Venue</th>
            <Th f={f} s="close">
              Closes in
            </Th>
            <Th f={f} s="bid">
              Bid
            </Th>
            <Th f={f} s="ask">
              Ask
            </Th>
            <Th f={f} s="spread">
              Spread
            </Th>
            <th>Size</th>
            <th>Last</th>
            <Th f={f} s="volume">
              Vol 24 h
            </Th>
            <Th f={f} s="oi">
              Open int.
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.venue}/${r.id}`}>
              <td className="contract" title={r.title}>
                <Link href={`/contract/${r.venue}/${encodeURIComponent(r.id)}`}>
                  {r.label || r.title}
                </Link>
                <span className="small">
                  {FAMILY_NAME.get(r.family) ?? r.family} · {r.venue === "kalshi" ? r.id : r.event}
                </span>
              </td>
              <td style={{ textAlign: "left" }}>
                {r.venue === "kalshi" ? "Kalshi" : "Polymarket"}
              </td>
              <td className="num" title={utc(r.close)}>
                {until(r.close, at)}
              </td>
              <td className="num">{cents(r.bid)}</td>
              <td className="num">{cents(r.ask)}</td>
              <td className="num">
                {r.bid !== null && r.ask !== null ? cents(r.ask - r.bid) : "–"}
              </td>
              <td className="num">
                {size(r.bidSize)} × {size(r.askSize)}
              </td>
              <td className="num">{cents(r.last)}</td>
              <td className="num">{volume(r)}</td>
              <td className="num">{r.openInterest === null ? "–" : size(r.openInterest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
