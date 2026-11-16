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
