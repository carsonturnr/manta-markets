// Markets: every open contract Manta covers in one sortable table (lib/screener.ts screen()),
// with a category and a search, and a one-line explanation under each column heading on hover or
// focus. Each row opens its Market page. Server-rendered: sorting and filtering are links and a
// GET form, so the view is a shareable URL.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProbBar } from "@/components/EventCard";
import LiveForm from "@/components/LiveForm";
import { type Category, FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { mid, outcomeLabel } from "@/lib/outcomes";
import { type Filters, PAGE, type Row, screen, type Sort } from "@/lib/screener";

export const metadata = { title: "Manta: markets" };

type Params = Record<string, string | string[] | undefined>;

const CATEGORIES: Category[] = ["Crypto", "Economics", "Financials"];
const FAMILY_NAME = new Map(FAMILIES.map((f) => [f.family, f.name]));
// The columns this page sorts by; the first is the default (most traded first).
const SORTABLE: Sort[] = ["dollars", "mid", "spread", "depth", "edge", "close"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function MarketsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <h1>Markets</h1>
      <p className="lede markets-lede">
        Every open crypto, economics and financial contract on Kalshi and Polymarket. A contract
        pays $1 if its outcome happens and nothing if not, so its price reads as a chance: 37¢ means
        traders put it at about 37%. Hover or tab to a column heading to see what it means.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** The URL's filters, each checked against what it may be; everything the page doesn't offer is
 * left at the screener's default. */
function parse(p: Params): Filters {
  const page = Number.parseInt(one(p.page), 10);
  const sort = SORTABLE.find((s) => s === one(p.sort)) ?? "dollars";
  return {
    venue: "",
    category: CATEGORIES.find((c) => c === one(p.cat)) ?? "",
    family: "",
    closes: "",
    traded: false,
    oneSided: false,
    spread: 0,
    q: one(p.q).trim().slice(0, 60),
    sort,
    // Most traded first by default; a URL can flip it.
    desc: p.dir === undefined ? sort === "dollars" : one(p.dir) === "desc",
    page: Number.isFinite(page) && page > 0 && page < 1000 ? page : 0,
  };
}

/** The URL for these filters with some changed; defaults are left out to keep links short. */
function href(f: Filters, change: Partial<Filters>): string {
  const g = { ...f, ...change };
  const u = new URLSearchParams();
  if (g.category) u.set("cat", g.category);
  if (g.q) u.set("q", g.q);
  if (g.sort !== "dollars") u.set("sort", g.sort);
  if (g.desc !== (g.sort === "dollars")) u.set("dir", g.desc ? "desc" : "asc");
  if (g.page) u.set("page", String(g.page));
  const s = u.toString();
  return s ? `/markets?${s}` : "/markets";
}

async function Markets({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const f = parse(await searchParams);
  const { rows, total, at, ageS } = await screen(f);
  const pages = Math.ceil(total / PAGE);
  return (
    <>
      <div className="markets-bar">
        <nav className="chip-row" aria-label="Category">
          {(["", ...CATEGORIES] as const).map((c) => (
            <Link
              key={c}
              href={href(f, { category: c, page: 0 })}
              className={c === f.category ? "chip-link on" : "chip-link"}
              aria-current={c === f.category ? "true" : undefined}
              scroll={false}
            >
              {c || "All"}
            </Link>
          ))}
        </nav>
        <LiveForm className="markets-form" action="/markets">
          {f.category && <input type="hidden" name="cat" value={f.category} />}
          {f.sort !== "dollars" && <input type="hidden" name="sort" value={f.sort} />}
          <input
            type="text"
            enterKeyHint="search"
            name="q"
            defaultValue={f.q}
            placeholder="Search: bitcoin, CPI, KXFED…"
            aria-label="Search markets"
          />
          <noscript>
            <button type="submit" className="btn btn-sm">
              Apply
            </button>
          </noscript>
        </LiveForm>
      </div>
      <p className="markets-count muted">
        {total.toLocaleString("en-US")} {total === 1 ? "contract" : "contracts"}
        {f.q && <> matching “{f.q}”</>}
        {at !== null && (
          <>
            {" "}
            · prices read {utc(at)}
            {ageS !== null && ageS > 180 && (
              <span className="status-bad"> ({Math.round(ageS / 60)} min old)</span>
            )}
          </>
        )}
      </p>
      {rows.length === 0 ? (
        <p className="muted">
          No contracts match. Try fewer words, or <Link href="/markets">see them all</Link>.
        </p>
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
        Prices come from each venue&apos;s market list, refreshed every minute; it can trail the
        live order book by up to a minute, which each Market page shows. Contracts quoted on one
        side only (mostly strikes far from the price) are left out. There is no 24-hour change
        column: Manta stores each contract&apos;s current price, not yesterday&apos;s. Not
        investment advice.
      </p>
    </>
  );
}

/** Cents with at most one decimal: 0.42 → "42¢", 0.918 → "91.8¢". */
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);

/** 1,234 → "1.2k", 2,500,000 → "2.5M". */
const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

function volume(r: Row): string {
  if (r.volume === 0) return "–";
  return r.volumeUnit === "usd" ? `$${short(r.volume)}` : short(r.volume);
}

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

// Each column's one-line explanation, shown under its heading on hover or keyboard focus and read
// by screen readers as the heading's description.
const HELP: Record<string, string> = {
  market: "The question and the outcome this contract pays on, with its venue and family.",
  mid: "Halfway between the best bid and ask: the market's price, read as a chance.",
  spread: "Best ask minus best bid: what buying and selling at once would cost you. Smaller is cheaper.",
  depth: "Contracts on offer at the best bid / best ask: how much trades at the shown price.",
  dollars: "Traded in the last 24 hours: contracts on Kalshi, dollars on Polymarket. Sorted by dollars.",
  edge: "Manta's fair value minus the price, in cents. Green: our estimate is higher. Sorted by size.",
  close: "Time until the contract stops trading.",
};

// A column heading: sorts by it (clicking the current sort flips its direction) and carries its
// help. Numbers start high-to-low, the close soonest-first.
function Th({ f, s, name }: { f: Filters; s: Sort | "market"; name: string }) {
  const on = f.sort === s;
  const tip = `help-${s}`;
  return (
    <th className="has-tip" aria-sort={on ? (f.desc ? "descending" : "ascending") : undefined}>
      {s === "market" ? (
        <span tabIndex={0} aria-describedby={tip}>
          {name}
        </span>
      ) : (
        <Link
          href={href(f, { sort: s, desc: on ? !f.desc : s !== "close", page: 0 })}
          aria-describedby={tip}
          scroll={false}
        >
          {name}
          {on ? (f.desc ? " ↓" : " ↑") : ""}
        </Link>
      )}
      <span role="tooltip" id={tip} className="th-tip">
        {HELP[s]}
      </span>
    </th>
  );
}

function Table({ rows, f, at }: { rows: Row[]; f: Filters; at: number }) {
  return (
    <div className="table-wrap screener-table markets-table">
      <table className="screener num">
        <thead>
          <tr>
            <Th f={f} s="market" name="Market" />
            <Th f={f} s="mid" name="Price" />
            <Th f={f} s="spread" name="Spread" />
            <Th f={f} s="depth" name="Size at best" />
            <Th f={f} s="dollars" name="Volume 24 h" />
            <Th f={f} s="edge" name="Gap to fair value" />
            <Th f={f} s="close" name="Closes" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.venue}/${r.id}`}>
              <td className="contract" title={r.title}>
                <Link
                  href={`/m/${r.venue}/${encodeURIComponent(r.event)}?o=${encodeURIComponent(r.id)}`}
                >
                  {outcomeLabel(r)}
                </Link>
                <span className="sub">
                  <span className={`venue ${r.venue}`}>
                    {r.venue === "kalshi" ? "Kalshi" : "Polymarket"}
                  </span>{" "}
                  · {FAMILY_NAME.get(r.family) ?? r.family}
                </span>
              </td>
              <td>
                <span className="chance">
                  <ProbBar o={r} />
                  <b>{cents(mid(r))}</b>
                </span>
              </td>
              <td>{r.bid !== null && r.ask !== null ? cents(r.ask - r.bid) : "–"}</td>
              <td className="m2">
                {r.bidSize === null ? "–" : short(r.bidSize)} /{" "}
                {r.askSize === null ? "–" : short(r.askSize)}
              </td>
              <td>{volume(r)}</td>
              <td>
                <Gap g={gap(r)} />
              </td>
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
