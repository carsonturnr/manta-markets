// The recorder's data-quality report for /quality. The VM writes it every 15 minutes
// (recorder/cmd/status -json, stored by manta-quality); this reads it and names what it lists.
import { cacheLife } from "next/cache";
import { sql } from "./db";

export { type Category, FAMILIES, VENUES } from "./families";

export type Gap = { from: string; to: string }; // ISO times, UTC

export type VenueReport = {
  venue: string;
  first: string;
  last: string; // last data message
  records: number;
  coverage: number; // 0–1: share of [first, last] not in a gap
  gaps: Gap[]; // oldest first
  hours: Record<string, number>; // "2026-11-16T14" → messages, last 7 days
};

export type FamilyReport = {
  venue: string;
  family: string;
  records_24h: number;
  contracts: number; // distinct contracts with data in the last 2 hours
};

export type Report = {
  generated: string;
  gap_seconds: number;
  venues: VenueReport[];
  families: FamilyReport[];
};

/** The latest report and its age in seconds when read, or null before the first is stored. */
export async function getReport(): Promise<{ report: Report; ageS: number } | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  const [row] = await sql`
    select report, extract(epoch from now() - updated) as age_s from manta.quality`;
  return row ? { report: row.report as Report, ageS: Number(row.age_s) } : null;
}
