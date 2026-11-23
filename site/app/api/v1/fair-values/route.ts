// GET /api/v1/fair-values?venue=&family=&event= (docs/plan-api.md): each open contract's fair
// value and its method. No quotes: lib/api.ts fairOut.
import { fairOut } from "@/lib/api";
import { answer, authorize } from "@/lib/apiRoute";
import { getFairValues } from "@/lib/screener";

export async function GET(request: Request) {
  const auth = await authorize(request, 1);
  if (auth instanceof Response) return auth;
  const q = new URL(request.url).searchParams;
  const { rows, at } = await getFairValues();
  const keep = (field: "venue" | "family" | "event", v: string) => !q.has(field) || q.get(field) === v;
  const data = rows.filter((r) => keep("venue", r.venue) && keep("family", r.family) && keep("event", r.event));
  return answer(data.map(fairOut), at, auth);
}
