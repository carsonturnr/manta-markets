"use client";
// The terminal's live data for the contract in focus: its order book and latest trades, fetched
// from /api/live every 2 s while the tab is visible and shared with every panel that needs them
// (book, depth, liquidity, tape, ticket) through one React context, so they poll once between them.
import { createContext, useContext, useEffect, useState } from "react";
import type { Book, Trade } from "@/lib/venues";

type Feed = { book: Book | null; trades: Trade[] | null; at: number | null; error: boolean };
const LiveContext = createContext<Feed>({ book: null, trades: null, at: null, error: false });

export const useLive = () => useContext(LiveContext);

export default function Live({
  venue,
  id,
  token,
  children,
}: {
  venue: string;
  id: string;
  token?: string;
  children: React.ReactNode;
}) {
  const [feed, setFeed] = useState<Feed>({ book: null, trades: null, at: null, error: false });
  useEffect(() => {
    let stop = false;
    const q = new URLSearchParams({ venue, id, ...(token ? { token } : {}) });
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/live?${q}`);
        const j = await r.json();
        if (!stop) setFeed({ book: j.book ?? null, trades: j.trades ?? null, at: Date.now(), error: !r.ok });
      } catch {
        if (!stop) setFeed((f) => ({ ...f, error: true })); // keep the last data, mark it stale
      }
    };
    load();
    const t = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [venue, id, token]);
  return <LiveContext.Provider value={feed}>{children}</LiveContext.Provider>;
}
