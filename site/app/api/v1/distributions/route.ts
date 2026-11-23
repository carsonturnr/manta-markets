// GET /api/v1/distributions?family=&event= (docs/plan-api.md): each ladder's implied
// distribution, read off the fitted curve (pricing/distribution.py).
import { answer, authorize } from "@/lib/apiRoute";
import { getDistributions } from "@/lib/distributions";

export async function GET(request: Request) {
  const auth = await authorize(request, 1);
  if (auth instanceof Response) return auth;
  const q = new URL(request.url).searchParams;
  const all = await getDistributions();
  const data = all
    .filter((d) => (!q.has("family") || q.get("family") === d.family) && (!q.has("event") || q.get("event") === d.event))
    .map((d) => ({
      venue: d.venue,
      family: d.family,
      event: d.event,
      title: d.title,
      close: new Date(d.close).toISOString(),
      method: d.method,
      median: d.median,
      q25: d.q25,
      q75: d.q75,
      mean: d.mean,
      sd: d.sd,
      implied_vol: d.vol,
      deribit_vol: d.deribitVol,
      curve: d.curve, // [x, P(value > x)], our fitted curve
      updated: new Date(d.updated).toISOString(),
    }));
  const updated = all.length ? Math.max(...all.map((d) => d.updated)) : null;
  return answer(data, updated, auth);
}
