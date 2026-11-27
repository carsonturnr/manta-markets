// News events (docs/product.md, tool 16; docs/plan-news-events.md): official news from the Fed,
// Treasury, BEA, the Labor Department and BLS, on the same clock as the order books. The VM's
// collector (recorder/cmd/news) writes each item as we first receive it; after each hourly replay
// `news -moves` measures how the books moved around it. replayserve hands both to this server with
// the replay's token; the fetchers are in lib/news-data.ts. This file holds the types and the pure
// figures, with no Next import, so node's test runner can load it.

export type NewsItem = {
  key: string; // 2026-11-25-fed-press-ebcc18ee: its name in URLs
  source: string;
  id: string;
  title: string;
  url: string;
  stated_ms: number; // when the source says it published
  stated_real: boolean; // false: that time is known not to be a publication time
  received_ms: number; // when our collector first got it
  backfill?: boolean; // already in the feed when the collector started: no real receipt time
};

/** One item's move summary. With `release`, it belongs to a scheduled release that event response
 * measures, and has no move of its own. */
export type NewsMove = {
  key: string;
  t0: number;
  t0_kind: "stated" | "received";
  release?: string;
  contracts: number; // with both a move and a baseline: the sample size
  moved: number; // of those, moved 1¢ or more in the 30 minutes after t0
  moved_before: number; // … and in the 30 minutes before (the baseline)
  top?: string;
  top_cents?: number;
};

export type FeedStats = {
  polls: number;
  not_modified: number;
  errors: number;
  last_error?: string;
  last_ok_ms?: number;
  items: number;
  interval_ms: number;
};

export type News = {
  items: NewsItem[];
  moves: NewsMove[];
  status: { since_ms: number; written_ms: number; feeds: Record<string, FeedStats> } | null;
};

export type ContractMove = {
  ticker: string;
  event: string;
  move_cents: number | null;
  before_cents: number | null; // the same contract's move over the 30 minutes before t0
  mids?: [number, number][]; // [unix ms, mid in cents] every minute, t0 − 30 min to + 30 min
};

export type MoveDetail = { key: string; t0: number; t0_kind: "stated" | "received"; contracts: ContractMove[] };

/** Each source: its name on the page, a short label for chart marks, and its agency for the
 * credit line (all public domain: shown with "Source: …"). */
export const SOURCES: Record<string, { name: string; short: string; agency: string }> = {
  "fed-press": { name: "Fed press release", short: "Fed", agency: "Board of Governors of the Federal Reserve System" },
  "fed-speech": { name: "Fed speech", short: "Fed", agency: "Board of Governors of the Federal Reserve System" },
  "treasury-press": { name: "Treasury press release", short: "UST", agency: "U.S. Department of the Treasury" },
  "treasury-auction": { name: "Treasury auction result", short: "Auction", agency: "U.S. Department of the Treasury (TreasuryDirect)" },
  bea: { name: "BEA release", short: "BEA", agency: "U.S. Bureau of Economic Analysis" },
  dol: { name: "Labor Department release", short: "DOL", agency: "U.S. Department of Labor" },
  "bls-cpi": { name: "BLS: CPI", short: "BLS", agency: "U.S. Bureau of Labor Statistics" },
  "bls-payrolls": { name: "BLS: payrolls", short: "BLS", agency: "U.S. Bureau of Labor Statistics" },
};
export const sourceName = (s: string) => SOURCES[s]?.name ?? s;

// The only names replayserve accepts; checked here too so a URL never reaches it unchecked.
export const NEWS_KEY = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

/** The moment an item is placed at, as the VM measures its move (recorder/internal/news T0): the
 * stated time where it is real, else our receipt time; a backfill item with no real stated time
 * has no known moment. */
export function t0(it: NewsItem): { t: number; kind: "stated" | "received" } | null {
  if (it.stated_real) return { t: it.stated_ms, kind: "stated" };
  if (!it.backfill) return { t: it.received_ms, kind: "received" };
  return null;
}

/** Receipt delay in ms (received − stated), only where both times are real. */
export const delay = (it: NewsItem) => (it.stated_real && !it.backfill ? it.received_ms - it.stated_ms : null);

/** Per source: how many items have a real delay, and its median and range. A source whose stated
 * time is not real has n = 0 and says so on the page. */
export function delays(items: NewsItem[]) {
  const by = new Map<string, number[]>();
  for (const s of Object.keys(SOURCES)) by.set(s, []);
  for (const it of items) {
    const d = delay(it);
    if (d !== null) by.get(it.source)?.push(d);
  }
  return [...by].map(([source, ds]) => {
    const s = [...ds].sort((a, b) => a - b);
    const m = s.length;
    const median = m === 0 ? null : m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
    return { source, n: m, median, min: m ? s[0] : null, max: m ? s[m - 1] : null };
  });
}

/** Items newest first, each with its move and `t`, where it is placed: its moment, or for an item
 * with none its stated time (the source's date, even if not to the minute: our receipt time
 * would be when the collector started, days later). */
export function joined(n: News) {
  const moves = new Map(n.moves.map((m) => [m.key, m]));
  return n.items
    .map((it) => {
      const at = t0(it);
      return { it, at, t: at?.t ?? it.stated_ms, move: moves.get(it.key) };
    })
    .sort((a, b) => b.t - a.t);
}

/** The headline figure: contracts that moved 1¢ or more after t0 minus those that did in the
 * 30 minutes before. Short-dated contracts drift all the time, so the raw count alone overstates
 * the news (2026-11-25's 16:30 auction: 405 after against 380 before). */
export const beyond = (m: NewsMove) => m.moved - m.moved_before;

/** "+25 more than before", "11 fewer than before", "same as before". */
export function beyondText(m: NewsMove): string {
  const d = beyond(m);
  if (d > 0) return `+${d} more than before`;
  if (d < 0) return `${-d} fewer than before`;
  return "same as before";
}

/** Over every measured moment (items at the same minute share one, and count once): how many
 * moments, and the average difference. */
export function overall(moves: NewsMove[]) {
  const byT0 = new Map<number, NewsMove>();
  for (const m of moves) if (!m.release && m.contracts > 0) byT0.set(m.t0, m);
  const ms = [...byT0.values()];
  if (ms.length === 0) return null;
  const avg = (f: (m: NewsMove) => number) => ms.reduce((s, m) => s + f(m), 0) / ms.length;
  return { moments: ms.length, after: avg((m) => m.moved), before: avg((m) => m.moved_before), contracts: avg((m) => m.contracts) };
}

// Which contract families each source's news plausibly moves (lib/families.ts ids), for chart
// marks only: every item is still listed on /insights/news and in the terminal's Catalysts list.
// A family in no group gets no marks.
const GROUPS = {
  rates: ["KXFED", "KXFEDDECISION", "fed-decision"],
  fx: ["KXEURUSD", "KXEURUSDH", "KXUSDJPY", "KXUSDJPYH"],
  indexes: ["KXINX", "KXINXU", "KXNASDAQ100", "KXNASDAQ100U"],
  crypto: ["KXBTCD", "KXBTC", "KXBTC15M", "KXETHD", "KXETH", "KXETH15M", "btc-above", "btc-price", "eth-above", "eth-price"],
  cpi: ["KXCPI", "KXCPIYOY", "KXCPICORE", "KXCPICOREYOY", "cpi"],
  jobs: ["KXPAYROLLS", "KXU3", "payrolls", "unemployment"],
};
type Group = keyof typeof GROUPS;
const fed: Group[] = ["rates", "fx", "indexes", "crypto"];
const treasury: Group[] = ["rates", "fx"];
const MOVES: Record<string, Group[]> = {
  "fed-press": fed,
  "fed-speech": fed,
  "treasury-press": treasury,
  "treasury-auction": treasury,
  bea: ["indexes", "rates"], // GDP and PCE have no recorded family of their own
  dol: ["jobs", "indexes", "rates"],
  "bls-cpi": ["cpi", "indexes", "rates"],
  "bls-payrolls": ["jobs", "indexes", "rates"],
};

/** Whether a source's news is marked on a family's chart. */
export const marksOn = (source: string, family: string) =>
  MOVES[source]?.some((g) => GROUPS[g].includes(family)) ?? false;

/** Chart marks for one family's candle chart: its sources' items with a known moment, oldest first. */
export const marks = (items: NewsItem[], family: string) =>
  items
    .flatMap((it) => {
      const at = t0(it);
      return at && marksOn(it.source, family) ? [{ t: at.t, short: SOURCES[it.source]?.short ?? it.source, title: it.title }] : [];
    })
    .sort((a, b) => a.t - b.t);
export type Mark = ReturnType<typeof marks>[number];

/** "+3.5¢", "−6.0¢", "n/a". */
export const signed = (x: number | null | undefined) =>
  x === null || x === undefined ? "n/a" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}¢`;

/** "23 s", "2 min 26 s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (Math.abs(s) < 60) return `${s} s`;
  return `${s < 0 ? "−" : ""}${Math.floor(Math.abs(s) / 60)} min ${Math.abs(s) % 60} s`;
}
