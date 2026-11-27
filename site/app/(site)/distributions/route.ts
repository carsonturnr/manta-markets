// The old distributions page: each ladder's distribution is now the "Likely range" panel of its
// Market page (and the terminal's DIST panel). ?e=<venue>/<event> opens that event's page.
import { bitcoinUrl, eventUrl } from "@/lib/old-urls";

export async function GET(req: Request) {
  const e = new URL(req.url).searchParams.get("e") ?? "";
  const [venue, ...rest] = e.split("/");
  const to = rest.length ? await eventUrl(venue, rest.join("/")) : await bitcoinUrl();
  return Response.redirect(new URL(to, req.url), 307);
}
