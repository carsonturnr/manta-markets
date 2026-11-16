// The recorder's data-quality report for /quality. The VM writes it every 15 minutes
// (recorder/cmd/status -json, stored by manta-quality); this reads it and names what it lists.
import { cacheLife } from "next/cache";
import { sql } from "./db";

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

// What each venue's recording holds, in words.
export const VENUES: Record<string, { name: string; what: string }> = {
  kalshi: { name: "Kalshi", what: "Order books and trades (WebSocket), REST order-book checks" },
  polymarket: { name: "Polymarket", what: "Order books every 10 s, event listings" },
  deribit: { name: "Deribit", what: "BTC and ETH option prices, index" },
  coinbase: { name: "Coinbase", what: "BTC-USD trades and ticker" },
  kraken: { name: "Kraken", what: "BTC/USD trades and ticker" },
  binance: { name: "Binance", what: "BTC/USDT trades and 1-minute candles" },
};

export type Category = "Crypto" | "Economics" | "Financials" | "Reference prices";

// Every family the recorder is meant to record: the explicit allow-lists in recorder/cmd/recorder
// (Kalshi series, names as Kalshi titles them) and recorder/internal/tap/polymarket.go, plus the
// reference prices used for fair values. Listed here, not taken from the report, so a family
// with no data shows up as missing instead of disappearing.
// `note` explains a family expected to have no data.
export const FAMILIES: {
  venue: string;
  family: string;
  name: string;
  category: Category;
  note?: string;
}[] = [
  { venue: "kalshi", family: "KXBTCD", name: "Bitcoin above/below", category: "Crypto" },
  { venue: "kalshi", family: "KXBTC", name: "Bitcoin range", category: "Crypto" },
  { venue: "kalshi", family: "KXBTC15M", name: "Bitcoin 15 minutes", category: "Crypto" },
  { venue: "kalshi", family: "KXETHD", name: "Ether above/below", category: "Crypto" },
  { venue: "kalshi", family: "KXETH", name: "Ether range", category: "Crypto" },
  { venue: "kalshi", family: "KXETH15M", name: "Ether 15 minutes", category: "Crypto" },
  { venue: "polymarket", family: "btc-above", name: "Bitcoin above, daily", category: "Crypto" },
  { venue: "polymarket", family: "btc-price", name: "Bitcoin range, daily", category: "Crypto" },
  { venue: "polymarket", family: "eth-above", name: "Ether above, daily", category: "Crypto" },
  { venue: "polymarket", family: "eth-price", name: "Ether range, daily", category: "Crypto" },
  { venue: "kalshi", family: "KXFEDDECISION", name: "Fed meeting decision", category: "Economics" },
  { venue: "kalshi", family: "KXFED", name: "Fed funds rate", category: "Economics" },
  { venue: "kalshi", family: "KXCPI", name: "CPI, monthly", category: "Economics" },
  { venue: "kalshi", family: "KXCPIYOY", name: "CPI, annual", category: "Economics" },
  { venue: "kalshi", family: "KXCPICORE", name: "Core CPI, monthly", category: "Economics" },
  { venue: "kalshi", family: "KXCPICOREYOY", name: "Core CPI, annual", category: "Economics" },
  { venue: "kalshi", family: "KXPAYROLLS", name: "Payrolls", category: "Economics" },
  { venue: "kalshi", family: "KXU3", name: "Unemployment rate", category: "Economics" },
  {
    venue: "polymarket",
    family: "fed-decision",
    name: "Fed meeting decision",
    category: "Economics",
  },
  { venue: "polymarket", family: "cpi", name: "CPI, monthly and annual", category: "Economics" },
  { venue: "polymarket", family: "unemployment", name: "Unemployment rate", category: "Economics" },
  { venue: "polymarket", family: "payrolls", name: "Payrolls", category: "Economics" },
  { venue: "kalshi", family: "KXINX", name: "S&P 500 range", category: "Financials" },
  { venue: "kalshi", family: "KXINXU", name: "S&P 500 above/below", category: "Financials" },
  { venue: "kalshi", family: "KXNASDAQ100", name: "Nasdaq-100 range", category: "Financials" },
  {
    venue: "kalshi",
    family: "KXNASDAQ100U",
    name: "Nasdaq-100 above/below",
    category: "Financials",
  },
  { venue: "kalshi", family: "KXEURUSD", name: "EUR/USD daily range", category: "Financials" },
  {
    venue: "kalshi",
    family: "KXEURUSDH",
    name: "EUR/USD over/under",
    category: "Financials",
    note: "no events since Jan 30",
  },
  { venue: "kalshi", family: "KXUSDJPY", name: "USD/JPY daily range", category: "Financials" },
  {
    venue: "kalshi",
    family: "KXUSDJPYH",
    name: "USD/JPY over/under",
    category: "Financials",
    note: "no events since Jan 30",
  },
  {
    venue: "deribit",
    family: "BTC",
    name: "Bitcoin options and index",
    category: "Reference prices",
  },
  {
    venue: "deribit",
    family: "ETH",
    name: "Ether options and index",
    category: "Reference prices",
  },
  { venue: "coinbase", family: "spot", name: "Bitcoin spot", category: "Reference prices" },
  { venue: "kraken", family: "spot", name: "Bitcoin spot", category: "Reference prices" },
  {
    venue: "binance",
    family: "spot",
    name: "Bitcoin spot (Polymarket settles on it)",
    category: "Reference prices",
  },
];
