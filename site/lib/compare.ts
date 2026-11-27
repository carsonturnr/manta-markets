// The cross-venue pairs (docs/product.md, step 4), replaced every minute on the VM with the
// screener's listing (recorder/internal/crossvenue, stored by manta-contracts).
import { cacheLife } from "next/cache";
import { sql } from "./db";

export type Side = {
  ids: string[];
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  fair: number | null; // a bundle's is the sum of its buckets' (null if any has none)
  // One contract's taker fee when buying at the ask or selling at the bid (a bundle: summed over
  // its buckets); null if a price or fee rate is missing.
  feeAtAsk: number | null;
  feeAtBid: number | null;
};

export type Pair = {
  topic: string;
  question: string;
  kind: "same" | "bundle" | "near";
  note: string;
  close: number; // unix ms
  kalshi: Side;
  poly: Side & { labels: string[] }; // the Polymarket contracts' own labels, for a bundle's buckets
};

/** Every pair, ordered by close and topic, and when the listing was read. */
export async function getPairs(): Promise<{ pairs: Pair[]; at: number | null }> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 120 });
  const rows = await sql`
    select p.*, extract(epoch from p.close_time) * 1000 as close,
           extract(epoch from p.updated) * 1000 as at,
           (select array_agg(m.label order by coalesce(m.low, m.high))
            from manta.markets m
            where m.venue = 'polymarket' and m.id = any(p.poly_ids)) as poly_labels,
           (select m.fair from manta.markets m
            where m.venue = 'kalshi' and m.id = p.kalshi_ids[1]) as kalshi_fair,
           (select m.fee_taker * m.ask * (1 - m.ask) from manta.markets m
            where m.venue = 'kalshi' and m.id = p.kalshi_ids[1]) as kalshi_fee_ask,
           (select m.fee_taker * m.bid * (1 - m.bid) from manta.markets m
            where m.venue = 'kalshi' and m.id = p.kalshi_ids[1]) as kalshi_fee_bid,
           (select case when count(m.fee_taker * m.ask) = cardinality(p.poly_ids)
                        then sum(m.fee_taker * m.ask * (1 - m.ask)) end
            from manta.markets m
            where m.venue = 'polymarket' and m.id = any(p.poly_ids)) as poly_fee_ask,
           (select case when count(m.fee_taker * m.bid) = cardinality(p.poly_ids)
                        then sum(m.fee_taker * m.bid * (1 - m.bid)) end
            from manta.markets m
            where m.venue = 'polymarket' and m.id = any(p.poly_ids)) as poly_fee_bid,
           (select case when count(m.fair) = cardinality(p.poly_ids) then sum(m.fair) end
            from manta.markets m
            where m.venue = 'polymarket' and m.id = any(p.poly_ids)) as poly_fair
    from manta.pairs p
    order by p.close_time, p.topic, p.ord`;
  return {
    pairs: rows.map((r) => ({
      topic: r.topic,
      question: r.question,
      kind: r.kind,
      note: r.note,
      close: Number(r.close),
      kalshi: {
        ids: r.kalshi_ids,
        bid: r.kalshi_bid,
        ask: r.kalshi_ask,
        bidSize: r.kalshi_bid_size,
        askSize: r.kalshi_ask_size,
        fair: r.kalshi_fair,
        feeAtAsk: r.kalshi_fee_ask,
        feeAtBid: r.kalshi_fee_bid,
      },
      poly: {
        ids: r.poly_ids,
        bid: r.poly_bid,
        ask: r.poly_ask,
        bidSize: r.poly_bid_size,
        askSize: r.poly_ask_size,
        fair: r.poly_fair,
        feeAtAsk: r.poly_fee_ask,
        feeAtBid: r.poly_fee_bid,
        labels: r.poly_labels ?? [],
      },
    })),
    at: rows.length ? Number(rows[0].at) : null,
  };
}

// Shared by the cross-venue page and the dashboard.
const mid = (s: Side) => (s.bid !== null && s.ask !== null ? (s.bid + s.ask) / 2 : null);

/** How far apart the venues are, in cents. A single contract against a single contract: the
 * difference of their midpoints. Against a bundle, whose midpoint is skewed by its buckets'
 * combined spread: how far Kalshi's midpoint lies outside the bundle's bid–ask range, 0 inside. */
export function gap(p: Pair): { cents: number; inside: boolean } | null {
  const km = mid(p.kalshi);
  if (km === null) return null;
  if (p.kind !== "bundle") {
    const qm = mid(p.poly);
    return qm === null ? null : { cents: (km - qm) * 100, inside: false };
  }
  const { bid, ask } = p.poly;
  if (bid === null || ask === null) return null;
  if (km >= bid && km <= ask) return { cents: 0, inside: true };
  return { cents: (km < bid ? km - bid : km - ask) * 100, inside: false };
}

/** If one venue's ask is below the other's bid, buying there and selling on the other locks in
 * the gap: how many cents before fees, and after both legs' taker fees (null if a fee rate is
 * unknown), per contract. */
export function crossed(p: Pair): { cents: number; net: number | null; buy: string; sell: string } | null {
  const k = p.kalshi;
  const q = p.poly;
  const net = (gap: number, buyFee: number | null, sellFee: number | null) =>
    buyFee === null || sellFee === null ? null : (gap - buyFee - sellFee) * 100;
  if (k.ask !== null && q.bid !== null && q.bid - k.ask > 1e-9) {
    const gap = q.bid - k.ask;
    return {
      cents: gap * 100,
      net: net(gap, k.feeAtAsk, q.feeAtBid),
      buy: "Kalshi",
      sell: "Polymarket",
    };
  }
  if (q.ask !== null && k.bid !== null && k.bid - q.ask > 1e-9) {
    const gap = k.bid - q.ask;
    return {
      cents: gap * 100,
      net: net(gap, q.feeAtAsk, k.feeAtBid),
      buy: "Polymarket",
      sell: "Kalshi",
    };
  }
  return null;
}

/** The pairs whose prices cross with something left after both legs' taker fees, best first, with
 * how many contracts both best prices carry (the thinner side limits it; null if a size is unknown). */
export function arbitrage(pairs: Pair[]) {
  return pairs
    .flatMap((p) => {
      const x = crossed(p);
      if (!x || x.net === null || x.net <= 1e-9) return [];
      const buy = x.buy === "Kalshi" ? p.kalshi : p.poly;
      const sell = x.buy === "Kalshi" ? p.poly : p.kalshi;
      const size =
        buy.askSize !== null && sell.bidSize !== null ? Math.floor(Math.min(buy.askSize, sell.bidSize)) : null;
      return [{ p, x: { ...x, net: x.net }, buy, sell, size }];
    })
    .sort((a, b) => b.x.net - a.x.net);
}
