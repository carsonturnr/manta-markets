// What every /api/v1 route does first (docs/plan-api.md): check the key and count the request,
// in one call to manta.api_use(). Next-only (it reaches the database); the pure parts are in
// lib/api.ts.
import { apiUse } from "./account";
import { bearer, hashKey, limitHeaders } from "./api";

const fail = (status: number, error: string, headers = new Headers()) => {
  headers.set("Cache-Control", "private, no-store");
  return Response.json({ error }, { status, headers });
};

export const badRequest = (error: string) => fail(400, error);
export const notFound = (error: string) => fail(404, error);

/** The rate-limit headers to answer with, or the refusal to return. `contract` ("venue:id") is
 * given only by /cost, whose venue fetch counts against the shared budget. */
export async function authorize(
  request: Request,
  cost: number,
  contract: string | null = null,
): Promise<Headers | Response> {
  const key = bearer(request.headers.get("authorization"));
  if (!key) return fail(401, "Send your key as 'Authorization: Bearer manta_…'. Make one on /account.");
  const use = await apiUse(hashKey(key), cost, contract);
  if (!use) return fail(401, "Unknown key. It may have been deleted.");
  const headers = limitHeaders(use.remaining, use.reset, Date.now());
  if (!use.allowed) {
    headers.set("Retry-After", headers.get("RateLimit-Reset") ?? "60");
    return fail(429, "Rate limit: 60 units a minute per account.", headers);
  }
  if (!use.venueOk) {
    headers.set("Retry-After", "1");
    return fail(503, "Too many live order-book reads across all API users this second.", headers);
  }
  return headers;
}

/** A successful answer: the data and when its numbers were computed (unix ms → ISO). */
export const answer = (data: unknown, updated: number | null, headers: Headers) =>
  Response.json({ data, updated: updated === null ? null : new Date(updated).toISOString() }, { headers });
