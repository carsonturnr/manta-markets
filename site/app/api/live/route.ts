// The terminal's live feed for one contract: its order book and latest trades, as JSON. Read-only,
// polled by the browser every 2 s; the venue calls behind it are cached for 2–3 s and shared by
// every viewer (lib/venues.ts), so polling can't multiply requests to Kalshi or Polymarket.
import { kalshiBook, kalshiTrades, polyBook, polyTrades } from "@/lib/venues";

// The query is checked before anything reaches a venue: a Kalshi ticker, or a Polymarket condition
// id (0x + 64 hex) with its "yes" token (digits).
const TICKER = /^[A-Z0-9.\-]{3,80}$/;
const CONDITION = /^0x[0-9a-f]{64}$/;
const TOKEN = /^\d{10,100}$/;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const venue = q.get("venue");
  const id = q.get("id") ?? "";
  if (venue === "kalshi" && TICKER.test(id)) {
    const [book, trades] = await Promise.all([kalshiBook(id), kalshiTrades(id)]);
    return Response.json({ book, trades });
  }
  const token = q.get("token") ?? "";
  if (venue === "polymarket" && CONDITION.test(id) && TOKEN.test(token)) {
    const [book, trades] = await Promise.all([polyBook(token), polyTrades(id, token)]);
    return Response.json({ book, trades });
  }
  return Response.json({ error: "Unknown contract" }, { status: 400 });
}
