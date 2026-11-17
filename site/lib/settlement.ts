// How each contract family settles, in plain English, for the contract page. Written from each
// family's rules as the venues publish them (read 2026-11-16: Kalshi's market rules and series
// settlement sources, Polymarket's event descriptions), not from memory. The venue's own rules are
// shown in full under this summary; if the two ever disagree, the venue's rules are what count.

type Unit = "usd" | "points" | "rate" | "percent" | "jobs";

export type Settlement = {
  subject: string; // what the contract is about, as the end of "Pays $1 if <subject> is …"
  unit: Unit;
  settles: string; // the value the venue uses, and where it comes from
};

const BRTI =
  "the average of CF Benchmarks' Bitcoin Real-Time Index (BRTI) over the 60 seconds before the close";
const ERTI =
  "the average of CF Benchmarks' Ether Real-Time Index over the 60 seconds before the close";
const BINANCE = (pair: string) =>
  `the close of the Binance ${pair} 1-minute candle ending at noon New York time; other exchanges don't count`;

export const SETTLEMENT: Record<string, Settlement> = {
  KXBTCD: { subject: "Bitcoin", unit: "usd", settles: BRTI },
  KXBTC: { subject: "Bitcoin", unit: "usd", settles: BRTI },
  KXBTC15M: {
    subject: "Bitcoin",
    unit: "usd",
    settles: `${BRTI}, compared with the same average 15 minutes earlier (the target price)`,
  },
  KXETHD: { subject: "Ether", unit: "usd", settles: ERTI },
  KXETH: { subject: "Ether", unit: "usd", settles: ERTI },
  KXETH15M: {
    subject: "Ether",
    unit: "usd",
    settles: `${ERTI}, compared with the same average 15 minutes earlier (the target price)`,
  },
  KXFEDDECISION: {
    subject: "the Fed's decision",
    unit: "rate",
    settles:
      "the Federal Reserve's decision at the meeting. Only one outcome can pay: a 50 bps hike pays the 50 bps contract, not the 25 bps one",
  },
  KXFED: {
    subject: "the upper bound of the Fed funds target range",
    unit: "percent",
    settles: "the upper bound published on the Federal Reserve's website after the meeting",
  },
  KXCPI: {
    subject: "CPI's one-month change",
    unit: "percent",
    settles: "the one-decimal value published by the Bureau of Labor Statistics",
  },
  KXCPIYOY: {
    subject: "CPI's 12-month change",
    unit: "percent",
    settles: "the one-decimal value published by the Bureau of Labor Statistics",
  },
  KXCPICORE: {
    subject: "core CPI's one-month change (less food and energy)",
    unit: "percent",
    settles:
      "the seasonally adjusted, one-decimal value published by the Bureau of Labor Statistics",
  },
  KXCPICOREYOY: {
    subject: "core CPI's 12-month change (less food and energy)",
    unit: "percent",
    settles: "the one-decimal value published by the Bureau of Labor Statistics",
  },
  KXPAYROLLS: {
    subject: "the month's change in nonfarm payrolls",
    unit: "jobs",
    settles: "the Bureau of Labor Statistics' Employment Situation report",
  },
  KXU3: {
    subject: "the unemployment rate (U-3)",
    unit: "percent",
    settles:
      "the seasonally adjusted rate in the Bureau of Labor Statistics' Employment Situation report",
  },
  KXINX: {
    subject: "the S&P 500",
    unit: "points",
    settles:
      "the index's end-of-day value. Kalshi names Google Finance as an example; its rulebook defines the official source",
  },
  KXINXU: {
    subject: "the S&P 500",
    unit: "points",
    settles:
      "the index value at the time named in the contract. Kalshi names Google Finance as an example; its rulebook defines the official source",
  },
  KXNASDAQ100: {
    subject: "the Nasdaq-100",
    unit: "points",
    settles:
      "the index's end-of-day value. Kalshi names Google Finance as an example; its rulebook defines the official source",
  },
  KXNASDAQ100U: {
    subject: "the Nasdaq-100",
    unit: "points",
    settles:
      "the index value at the time named in the contract. Kalshi names Google Finance as an example; its rulebook defines the official source",
  },
  KXEURUSD: {
    subject: "EUR/USD",
    unit: "rate",
    settles: "the pair's open price at 10 am New York time, from ICE",
  },
  KXUSDJPY: {
    subject: "USD/JPY",
    unit: "rate",
    settles: "the pair's open price at 10 am New York time, from ICE",
  },
  "btc-above": { subject: "Bitcoin", unit: "usd", settles: BINANCE("BTC/USDT") },
  "btc-price": {
    subject: "Bitcoin",
    unit: "usd",
    settles: `${BINANCE("BTC/USDT")}. A value exactly on a boundary goes to the higher range`,
  },
  "eth-above": { subject: "Ether", unit: "usd", settles: BINANCE("ETH/USDT") },
  "eth-price": {
    subject: "Ether",
    unit: "usd",
    settles: `${BINANCE("ETH/USDT")}. A value exactly on a boundary goes to the higher range`,
  },
  "fed-decision": {
    subject: "the Fed's decision",
    unit: "rate",
    settles:
      "the change in the upper bound of the target range, from the FOMC statement after the meeting. A change between the options is rounded up to the nearest 25 bps",
  },
  cpi: {
    subject: "CPI's change", // made precise from the event: summary() below
    unit: "percent",
    settles: "the one-decimal value in the Bureau of Labor Statistics' CPI report",
  },
  unemployment: {
    subject: "the unemployment rate (U-3)",
    unit: "percent",
    settles:
      "the seasonally adjusted rate in the Bureau of Labor Statistics' Employment Situation report, as first released; later revisions don't count",
  },
  payrolls: {
    subject: "the month's change in nonfarm payrolls",
    unit: "jobs",
    settles:
      "the Bureau of Labor Statistics' Employment Situation report. A value exactly on a boundary goes to the higher range",
  },
};

/** A strike in its unit: $74,299.99, 7,444.9999, 3.3%, 90,000 jobs. */
export function strike(v: number, unit: Unit): string {
  // Percentages keep one decimal at least, as the BLS publishes them: 1.0%, not 1%.
  const min = unit === "percent" ? 1 : 0;
  const n = v.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: 6 });
  if (unit === "usd") return `$${n}`;
  if (unit === "percent") return `${n}%`;
  if (unit === "jobs") return `${n} jobs`;
  return n;
}

/** "Pays $1 if Bitcoin is above $74,299.99", from the contract model's payoff and strikes. */
export function summary(c: {
  family: string;
  payoff: string;
  low: number | null;
  high: number | null;
  inclusive: boolean;
  label: string;
  event: string;
}): string {
  const s = SETTLEMENT[c.family];
  if (!s) return c.label;
  // Polymarket's CPI events are monthly or annual by slug: "november-inflation-us-annual".
  const subject =
    c.family === "cpi"
      ? c.event.endsWith("-annual")
        ? "CPI's 12-month change"
        : "CPI's one-month change"
      : s.subject;
  const k = (v: number | null) => (v === null ? "?" : strike(v, s.unit));
  switch (c.payoff) {
    case "above":
      return `Pays $1 if ${subject} is ${c.inclusive ? "at or above" : "above"} ${k(c.low)}`;
    case "below":
      return `Pays $1 if ${subject} is ${c.inclusive ? "at or below" : "below"} ${k(c.high)}`;
    case "between":
      return `Pays $1 if ${subject} is from ${k(c.low)} to ${k(c.high)}`;
    case "exact":
      return `Pays $1 if ${subject} is ${k(c.low)}`;
    default:
      return `Pays $1 if ${subject} is: ${c.label}`;
  }
}

// How a fair value was made (manta.markets.fair_method; pricing/fairvalues.py), in words.
export const METHODS: Record<string, { name: string; short: string; explain: string }> = {
  options: {
    name: "Options-implied",
    short: "options",
    explain:
      "From Deribit's options: the volatility the options market expects at this strike and time, applied to the price this contract settles on: Deribit's index (a stand-in for CF Benchmarks') averaged over the final 60 seconds for Kalshi, Binance's 1-minute close for Polymarket.",
  },
  "consensus-2": {
    name: "Two-venue consensus",
    short: "2 venues",
    explain:
      "The probability curve that best fits both Kalshi's and Polymarket's quotes on this event, each quote weighted by how tight its spread is, made consistent across strikes (a higher threshold is never likelier than a lower one) or, for the Fed, across outcomes (they sum to 100%). A threshold with no quote, or quoted more than 20¢ wide, is left out of the fit; it is read off the curve between the quotes that are.",
  },
  "consensus-1": {
    name: "One-venue consensus",
    short: "1 venue",
    explain:
      "Fitted to this venue's own quotes on this event only and made consistent across strikes. It adds no outside information: on a well-quoted ladder it repeats the market's price. Thresholds with no quote or quoted more than 20¢ wide are left out of the fit, and a ladder quoted only that wide gets no fair value.",
  },
};
