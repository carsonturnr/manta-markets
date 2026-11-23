// GET /api/v1/cost?venue=&id=&side=buy|sell&n= (docs/plan-api.md): what taking N contracts costs
// now, from the live book (lib/venues.ts, cached 2 s) and the venue's fee (lib/cost.ts). Costs 5
// units, and a book not read in the last 2 s takes from the shared venue budget. Answers with the
// totals and the best price, never the levels walked (lib/api.ts costOut).
import { costOut, COST_UNITS, parseCost } from "@/lib/api";
import { answer, authorize, badRequest, notFound } from "@/lib/apiRoute";
import { kalshiFee, polymarketFee, walk } from "@/lib/cost";
import { getMarket } from "@/lib/screener";
import { kalshiBook, polyBook, polyTokens } from "@/lib/venues";

export async function GET(request: Request) {
  const q = parseCost(new URL(request.url).searchParams);
  if (typeof q === "string") return badRequest(q);
  const auth = await authorize(request, COST_UNITS, `${q.venue}:${q.id}`);
  if (auth instanceof Response) return auth;
  const m = await getMarket(q.venue, q.id);
  if (!m) return notFound("No open contract with that venue and id (see /api/v1/fair-values).");
  const tokens = q.venue === "polymarket" ? await polyTokens(m.row.event, q.id) : null;
  const book = q.venue === "kalshi" ? await kalshiBook(q.id) : tokens ? await polyBook(tokens[0]) : null;
  if (!book) return Response.json({ error: "The venue's order book could not be read." }, { status: 502, headers: auth });
  const rate = m.row.feeTaker;
  const fee = (n: number, p: number) =>
    rate === null ? 0 : q.venue === "kalshi" ? kalshiFee(rate, n, p) : polymarketFee(rate, n, p);
  const c = walk(q.side, q.n, q.side === "buy" ? book.asks : book.bids, fee);
  if (!c) return Response.json({ error: `No ${q.side === "buy" ? "asks" : "bids"} on the book.` }, { status: 409, headers: auth });
  const now = Date.now();
  return answer(costOut(c, now, rate !== null), now, auth);
}
