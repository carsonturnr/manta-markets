// The "Market brief" (lib/brief.ts builds the prompt): gathers Manta's own data on one contract and
// asks Claude for 3-5 plain bullets. Server only; the key (ANTHROPIC_API_KEY) never leaves it and is
// never logged. No user data goes in. Any failure returns null and the page hides the section.
import { cacheLife } from "next/cache";
import { midBars } from "./candles";
import { getPairs } from "./compare";
import { bookFacts, briefPrompt, parseBullets, priceMoves, SYSTEM, tradeFlow } from "./brief";
import { getMarket, type Row } from "./screener";
import { METHODS, summary } from "./settlement";
import {
  kalshiBook,
  kalshiCandles,
  kalshiTrades,
  polyBook,
  polyCandles,
  polyTokens,
  polyTrades,
} from "./venues";

// The model the claude-api skill recommends (2026-11-25). Thinking is always on for it; low effort
// keeps a summary of a dozen numbers quick and cheap.
const MODEL = "claude-opus-5-5";

/** One contract's brief, cached about 5 minutes per contract and shared by every viewer, so the
 * model is called at most once per contract every 5 minutes (per server instance). */
export async function getBrief(venue: string, id: string): Promise<string[] | null> {
  "use cache";
  const key = process.env.ANTHROPIC_API_KEY;
  const got = key ? await getMarket(venue, id) : null;
  if (!key || !got) {
    cacheLife({ stale: 60, revalidate: 60, expire: 300 });
    return null;
  }
  const bullets = await ask(key, await prompt(got.row));
  // A failure is retried after a minute rather than kept for five.
  if (bullets) cacheLife({ stale: 300, revalidate: 300, expire: 600 });
  else cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  return bullets;
}

async function prompt(c: Row) {
  const now = Date.now();
  const kalshi = c.venue === "kalshi";
  const yes = kalshi ? null : (await polyTokens(c.event, c.id))?.[0];
  const [bars, book, trades, { pairs }] = await Promise.all([
    kalshi
      ? kalshiCandles(c.family, c.id, "1m").then((cs) => (cs ? midBars(cs) : null))
      : yes
        ? polyCandles(yes, "1m")
        : null,
    kalshi ? kalshiBook(c.id) : yes ? polyBook(yes) : null,
    kalshi ? kalshiTrades(c.id) : yes ? polyTrades(c.id, yes) : null,
    getPairs(),
  ]);
  // The other venue's price, when this contract is one whole side of a cross-venue pair.
  const pair = pairs.find((p) =>
    kalshi ? p.kalshi.ids.length === 1 && p.kalshi.ids[0] === c.id : p.poly.ids.length === 1 && p.poly.ids[0] === c.id,
  );
  const other = pair ? (kalshi ? pair.poly : pair.kalshi) : null;
  const usable = c.fair !== null && c.fairMethod !== null && c.fairMethod !== "consensus-1";
  return briefPrompt({
    contract: `${summary(c)}, closing ${new Date(c.close).toUTCString()}`,
    venue: kalshi ? "Kalshi" : "Polymarket",
    minutesToClose: (c.close - now) / 60_000,
    moves: bars ? priceMoves(bars, now / 1000) : null,
    book: book ? bookFacts(book) : null,
    volume24h:
      c.volumeUnit === "usd"
        ? `$${Math.round(c.volume).toLocaleString("en-US")}`
        : `${Math.round(c.volume).toLocaleString("en-US")} contracts`,
    flow: trades ? tradeFlow(trades, now) : null,
    fair: usable && c.fair !== null && c.fairMethod ? { value: c.fair, method: METHODS[c.fairMethod].name } : null,
    other:
      pair && other
        ? { venue: kalshi ? "Polymarket" : "Kalshi", bid: other.bid, ask: other.ask, note: pair.note }
        : null,
  });
}

/** One Messages API call, raw fetch (no SDK dependency). Cost guard: at most 2,000 output tokens
 * (thinking included) and 20 seconds. */
async function ask(key: string, facts: string): Promise<string[] | null> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2026-10-21",
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        output_config: { effort: "low" },
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: facts }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.error(`market brief: Anthropic API answered ${r.status}`);
      return null;
    }
    const m = (await r.json()) as { stop_reason: string; content: { type: string; text?: string }[] };
    if (m.stop_reason === "refusal") return null;
    const text = m.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n");
    return parseBullets(text);
  } catch (e) {
    console.error(`market brief: ${e instanceof Error ? e.name : "error"}`);
    return null;
  }
}
