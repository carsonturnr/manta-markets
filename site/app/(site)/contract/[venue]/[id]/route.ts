// The old contract page: now that contract in focus on its event's Market page.
import { contractUrl } from "@/lib/old-urls";

export async function GET(req: Request, ctx: RouteContext<"/contract/[venue]/[id]">) {
  const { venue, id } = await ctx.params;
  return Response.redirect(new URL(await contractUrl(venue, decodeURIComponent(id)), req.url), 307);
}
