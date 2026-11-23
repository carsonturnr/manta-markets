// The terminal's live Kalshi book and trades, pushed by the recorder's relay on the VM
// (recorder/internal/relay) and passed through unchanged as Server-Sent Events. Only this server
// knows RELAY_TOKEN; the browser falls back to polling /api/live when this stream is down.
import { vmGet } from "@/lib/vm";

const TICKER = /^[A-Z0-9.\-]{3,80}$/; // the same check as /api/live

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker") ?? "";
  const url = process.env.RELAY_URL;
  const token = process.env.RELAY_TOKEN;
  if (!TICKER.test(ticker)) return Response.json({ error: "Unknown contract" }, { status: 400 });
  if (!url || !token) return Response.json({ error: "Relay not configured" }, { status: 503 });
  try {
    // request.signal: the relay stream closes when the browser leaves.
    const res = await vmGet(`${url}/stream?tickers=${ticker}`, token, request.signal);
    if (!res.ok) return Response.json({ error: "Relay unavailable" }, { status: 502 });
    return new Response(res.body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    });
  } catch {
    return Response.json({ error: "Relay unavailable" }, { status: 502 });
  }
}
