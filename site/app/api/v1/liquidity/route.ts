// GET /api/v1/liquidity (docs/plan-api.md): per family, the latest medians over active contracts
// and the median spread by hour of day over 14 days (pricing/liquidity.py).
import { answer, authorize } from "@/lib/apiRoute";
import { getLiquidity } from "@/lib/liquidity";

export async function GET(request: Request) {
  const auth = await authorize(request, 1);
  if (auth instanceof Response) return auth;
  const l = await getLiquidity();
  const data = {
    now: l.now.map((n) => ({
      venue: n.venue,
      family: n.family,
      contracts: n.contracts,
      active: n.active,
      median_spread: n.spread,
      median_size: n.size,
    })),
    by_hour: l.hours.map((h) => ({ venue: h.venue, family: h.family, hour_utc: h.hour, median_spread: h.spread, samples: h.n })),
  };
  return answer(data, l.at, auth);
}
