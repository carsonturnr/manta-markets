// The old Bitcoin tracker's contract page: now that contract on its event's Market page.
import { contractUrl } from "@/lib/old-urls";

export async function GET(req: Request, ctx: RouteContext<"/c/[ticker]">) {
  const { ticker } = await ctx.params;
  return Response.redirect(new URL(await contractUrl("kalshi", decodeURIComponent(ticker)), req.url), 307);
}
