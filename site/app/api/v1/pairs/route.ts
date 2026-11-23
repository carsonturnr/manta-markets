// GET /api/v1/pairs (docs/plan-api.md): each cross-venue pair's gap and any crossing after both
// venues' taker fees (lib/compare.ts). No quotes: lib/api.ts pairOut.
import { pairOut } from "@/lib/api";
import { answer, authorize } from "@/lib/apiRoute";
import { crossed, gap, getPairs } from "@/lib/compare";

export async function GET(request: Request) {
  const auth = await authorize(request, 1);
  if (auth instanceof Response) return auth;
  const { pairs, at } = await getPairs();
  return answer(pairs.map((p) => pairOut(p, gap(p), crossed(p))), at, auth);
}
