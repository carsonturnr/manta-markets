// The old Bitcoin tracker: its ladder is now a panel of the Bitcoin Market pages.
import { bitcoinUrl } from "@/lib/old-urls";

export async function GET(req: Request) {
  return Response.redirect(new URL(await bitcoinUrl(), req.url), 307);
}
