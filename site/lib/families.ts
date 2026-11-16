// Names for what Manta covers: venues and contract families. Shared by /quality and /screener.

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

// Every family the recorder records and the screener lists: the explicit allow-lists in
// recorder/internal/tap (Kalshi series, named as Kalshi titles them; Polymarket families), plus
// the reference prices used for fair values. Listed here, not taken from the report, so a family
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
