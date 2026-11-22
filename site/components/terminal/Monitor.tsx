"use client";
// The market monitor: every event Manta covers on both venues, filtered and sorted in the browser
// (the list is already on the page, so typing and sorting need no request). Clicking a row puts
// that market in focus in every panel.
import Link from "next/link";
import { useMemo, useState } from "react";

export type MonitorRow = {
  key: string; // venue/event
  venue: "kalshi" | "polymarket";
  question: string;
  category: string;
  close: number; // ms
  volume: number;
  usd: boolean; // volume in dollars (Polymarket) rather than contracts (Kalshi)
  outcomes: number;
  focusId: string; // the contract to open: the most informative one
  label: string; // its outcome
  mid: number | null;
  spread: number | null;
  gap: number | null; // Manta's fair minus mid, when usable
};

const SORTS = { volume: "Volume", close: "Closing", spread: "Spread", gap: "Gap" } as const;
type Sort = keyof typeof SORTS;
const CATS = ["All", "Crypto", "Economics", "Financials"];

const pct = (p: number | null) => (p === null ? "–" : `${Math.round(p * 100)}%`);
const vol = (v: number, usd: boolean) =>
  `${usd ? "$" : ""}${v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v)}`;
function left(close: number, now: number) {
  const m = Math.round((close - now) / 60_000);
  return m < 60 ? `${Math.max(m, 0)}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export default function Monitor({
  rows,
  focus,
  layout,
  now,
}: {
  rows: MonitorRow[];
  focus: string; // venue:id of the contract in focus
  layout: string;
  now: number;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("volume");
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const by: Record<Sort, (r: MonitorRow) => number> = {
      volume: (r) => -r.volume,
      close: (r) => r.close,
      spread: (r) => r.spread ?? 1,
      gap: (r) => -Math.abs(r.gap ?? 0),
    };
    return rows
      .filter((r) => cat === "All" || r.category === cat)
      .filter((r) => words.every((w) => `${r.question} ${r.label}`.toLowerCase().includes(w)))
      .sort((a, b) => by[sort](a) - by[sort](b));
  }, [rows, q, cat, sort]);
  return (
    <div className="t-monitor">
      <div className="t-mon-tools">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter markets"
          aria-label="Filter markets"
        />
        <div className="t-seg">
          {CATS.map((c) => (
            <button key={c} type="button" className={c === cat ? "on" : ""} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="t-seg">
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <button key={s} type="button" className={s === sort ? "on" : ""} onClick={() => setSort(s)}>
              {SORTS[s]}
            </button>
          ))}
        </div>
      </div>
      <ul className="t-mon-list">
        {shown.map((r) => {
          const id = `${r.venue}:${r.focusId}`;
          return (
            <li key={r.key}>
              <Link
                href={`/terminal?m=${encodeURIComponent(id)}&layout=${layout}`}
                className={id === focus ? "on" : undefined}
                scroll={false}
              >
                <span className="t-mon-q">
                  <span className={`t-venue ${r.venue}`}>{r.venue === "kalshi" ? "K" : "P"}</span>
                  {r.question}
                </span>
                <span className="t-mon-fig num">
                  <span className="t-dim">{r.label}</span>
                  <b>{pct(r.mid)}</b>
                </span>
                <span className="t-mon-meta num">
                  <span>{vol(r.volume, r.usd)}</span>
                  <span>{r.spread === null ? "–" : `${Math.round(r.spread * 1000) / 10}¢`}</span>
                  <span className={r.gap === null ? "" : r.gap > 0 ? "up" : "down"}>
                    {r.gap === null ? "" : `${r.gap > 0 ? "+" : "−"}${Math.abs(Math.round(r.gap * 1000) / 10)}`}
                  </span>
                  <span>{left(r.close, now)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="t-foot">
        {shown.length} of {rows.length} markets · volume · spread · Manta gap (pts) · time to close
      </p>
    </div>
  );
}
