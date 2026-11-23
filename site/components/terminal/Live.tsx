"use client";
// The terminal's live data for the contract in focus: its order book and latest trades, shared with
// every panel that needs them (book, depth, liquidity, tape, ticket) through one React context.
// Kalshi contracts stream from the recorder's relay (/api/live/stream) while it is up and its book
// is complete; otherwise, and for Polymarket, /api/live is polled every 2 s while the tab is visible.
import { createContext, useContext, useEffect, useState } from "react";
import { mergeTrades, relayBook, relayTrades, type RelayUpdate } from "@/lib/live";
import type { Book, Trade } from "@/lib/venues";

type Feed = {
  book: Book | null;
  trades: Trade[] | null;
  at: number | null;
  error: boolean;
  streaming: boolean;
};
const empty: Feed = { book: null, trades: null, at: null, error: false, streaming: false };
const LiveContext = createContext<Feed>(empty);

export const useLive = () => useContext(LiveContext);

// After the relay stream fails outright (an error response, which EventSource never retries), try
// it again this often; meanwhile polling carries the panels.
const RETRY_MS = 30_000;

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
  const [feed, setFeed] = useState<Feed>(empty);
  useEffect(() => {
    let stop = false;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let streaming = false; // stream open and its last book complete: polling pauses
    const q = new URLSearchParams({ venue, id, ...(token ? { token } : {}) });

    const load = async () => {
      if (document.visibilityState !== "visible" || streaming) return;
      try {
        const r = await fetch(`/api/live?${q}`);
        const j = await r.json();
        if (stop) return;
        // The stream may have started while this was in flight: then only its older trades count.
        setFeed((f) =>
          f.streaming
            ? { ...f, trades: mergeTrades(f.trades ?? [], j.trades ?? null) }
            : { book: j.book ?? null, trades: j.trades ?? null, at: Date.now(), error: !r.ok, streaming: false },
        );
      } catch {
        if (!stop) setFeed((f) => ({ ...f, error: true })); // keep the last data, mark it stale
      }
    };

    const open = () => {
      if (venue !== "kalshi" || es || stop || document.visibilityState !== "visible") return;
      const s = new EventSource(`/api/live/stream?ticker=${encodeURIComponent(id)}`);
      es = s;
      s.onmessage = (e) => {
        const u = JSON.parse(e.data) as RelayUpdate;
        streaming = u.live;
        if (!u.live) {
          setFeed((f) => ({ ...f, streaming: false })); // incomplete book: polled until the next snapshot
          return;
        }
        setFeed((f) => ({
          book: relayBook(u),
          trades: mergeTrades(relayTrades(u), f.trades),
          at: Date.now(),
          error: false,
          streaming: true,
        }));
      };
      s.onerror = () => {
        streaming = false; // EventSource reconnects by itself after a dropped connection...
        setFeed((f) => ({ ...f, streaming: false }));
        if (s.readyState === EventSource.CLOSED) {
          es = null; // ...but not after an error response: try again later
          retry = setTimeout(open, RETRY_MS);
        }
      };
    };
    const close = () => {
      es?.close();
      es = null;
      streaming = false;
      clearTimeout(retry);
    };
    // A hidden tab neither polls nor holds a stream open.
    const onVisibility = () => (document.visibilityState === "visible" ? (open(), load()) : close());

    load(); // the first paint, and the trades from before the stream starts
    open();
    const t = setInterval(load, 2000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop = true;
      clearInterval(t);
      close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [venue, id, token]);
  return <LiveContext.Provider value={feed}>{children}</LiveContext.Provider>;
}
