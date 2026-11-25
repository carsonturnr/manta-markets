// Markets: every open question as one card per event ("What will the Fed decide on December 9?",
// "Where will Bitcoin be at 5 pm ET today?"), the plain-language way in; the full table of
// contracts stays at /screener under Tools. Server-rendered from getEvents(); the only
// browser code is the search box's live form.
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import EventCard from "@/components/EventCard";
import LiveForm from "@/components/LiveForm";
import { getEvents } from "@/lib/events";
import { FILTERS, type Filter, order, pick, search, SORTS, type Sort } from "@/lib/markets";

export const metadata = { title: "Manta: markets" };

type Params = Record<string, string | string[] | undefined>;

// Enough to fill a phone's first few screens without sending every card.
const FIRST = 24;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function MarketsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <>
      <h1>Markets</h1>
      <p className="lede markets-lede">
        Every crypto, economics and financial question on Kalshi and Polymarket, one card per
        event. Prices read as chances: a contract at 37¢ pays $1 if it happens and nothing if it
        doesn&apos;t, so traders are putting it at about a 37% chance. The mint dot on each bar is
        Manta&apos;s fair value, our own estimate of that chance (
        <Link href="/stats">how it is made and how accurate it has been</Link>).
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Markets searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Markets({ searchParams }: { searchParams: Promise<Params> }) {
  await connection(); // request time only: the build never queries the database
  const p = await searchParams;
  const cat: Filter = FILTERS.find((c) => c === one(p.cat)) ?? "All";
  const sort: Sort = one(p.sort) === "close" ? "close" : "volume";
  const q = one(p.q).trim().slice(0, 60);
  const all = one(p.all) === "1";
  const { events, at } = await getEvents();
  const now = at ?? 0;
  const found = order(search(pick(events, cat, now), q), sort);
  const shown = all ? found : found.slice(0, FIRST);

  // A link to this view with some filters changed; defaults are left out to keep links short.
  const href = (c: { cat?: Filter; all?: boolean }) => {
    const u = new URLSearchParams();
    const k = c.cat ?? cat;
    if (k !== "All") u.set("cat", k);
    if (q) u.set("q", q);
    if (sort !== "volume") u.set("sort", sort);
    if (c.all) u.set("all", "1");
    const s = u.toString();
    return s ? `/markets?${s}` : "/markets";
  };

  return (
    <>
      <div className="markets-bar">
        <nav className="chip-row" aria-label="Show">
          {FILTERS.map((c) => (
            <Link
              key={c}
              href={href({ cat: c })}
              className={c === cat ? "chip-link on" : "chip-link"}
              aria-current={c === cat ? "true" : undefined}
              scroll={false}
            >
              {c}
            </Link>
          ))}
        </nav>
        <LiveForm className="markets-form" action="/markets">
          {cat !== "All" && <input type="hidden" name="cat" value={cat} />}
          <input
            type="text"
            enterKeyHint="search"
            name="q"
            defaultValue={q}
            placeholder="Search: fed, bitcoin, CPI…"
            aria-label="Search markets"
          />
          <select name="sort" defaultValue={sort} aria-label="Order">
            {Object.entries(SORTS).map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
          <noscript>
            <button type="submit" className="btn btn-sm">
              Apply
            </button>
          </noscript>
        </LiveForm>
      </div>
      <p className="markets-count muted">
        {found.length === 1 ? "1 event" : `${found.length} events`}
        {q && <> matching “{q}”</>}. Want every contract in one table?{" "}
        <Link href="/screener">Open the screener</Link>.
      </p>
      {shown.length === 0 ? (
        <p className="muted">
          No markets match. Try fewer words, or <Link href="/markets">see them all</Link>.
        </p>
      ) : (
        <div className="event-grid">
          {shown.map((e) => (
            <EventCard key={`${e.venue}/${e.event}`} e={e} now={now} />
          ))}
        </div>
      )}
      {shown.length < found.length && (
        <p className="markets-more">
          <Link href={href({ all: true })} className="btn btn-sm btn-ghost" scroll={false}>
            Show all {found.length} events
          </Link>
        </p>
      )}
    </>
  );
}
