// What each family's numbers are (Bitcoin's price in dollars, CPI in percent, …), shared by
// server pages and client components: no database or server imports here.

/** What a family's ladder is on, its unit and its underlying (for the term structure). */
type Underlying = "Bitcoin" | "Ether" | "S&P 500" | "Nasdaq-100" | "EUR/USD" | "USD/JPY";
const ON: Record<string, { on: string; fmt: (x: number) => string; under?: Underlying }> = {};
const dollars = (x: number) => "$" + x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const level = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (d: number) => (x: number) => `${x.toFixed(d)}%`;
for (const f of ["KXBTCD", "KXBTC", "KXBTC15M", "btc-above", "btc-price"])
  ON[f] = { on: "Bitcoin's price", fmt: dollars, under: "Bitcoin" };
for (const f of ["KXETHD", "KXETH", "KXETH15M", "eth-above", "eth-price"])
  ON[f] = { on: "Ether's price", fmt: dollars, under: "Ether" };
for (const f of ["KXINX", "KXINXU"]) ON[f] = { on: "the S&P 500", fmt: level, under: "S&P 500" };
for (const f of ["KXNASDAQ100", "KXNASDAQ100U"])
  ON[f] = { on: "the Nasdaq-100", fmt: level, under: "Nasdaq-100" };
for (const f of ["KXEURUSD", "KXEURUSDH"])
  ON[f] = { on: "EUR/USD", fmt: (x) => x.toFixed(4), under: "EUR/USD" };
for (const f of ["KXUSDJPY", "KXUSDJPYH"])
  ON[f] = { on: "USD/JPY", fmt: (x) => x.toFixed(2), under: "USD/JPY" };
ON.KXFED = { on: "the Fed funds rate (upper bound)", fmt: pct(2) };
for (const f of ["KXCPI", "KXCPICORE"]) ON[f] = { on: "the monthly CPI change", fmt: pct(1) };
for (const f of ["KXCPIYOY", "KXCPICOREYOY"]) ON[f] = { on: "annual CPI inflation", fmt: pct(1) };
ON.cpi = { on: "CPI inflation", fmt: pct(1) };
ON.KXU3 = ON.unemployment = { on: "the unemployment rate", fmt: pct(1) };
ON.KXPAYROLLS = ON.payrolls = {
  on: "payrolls (jobs added)",
  fmt: (x) => `${Math.round(x / 1000).toLocaleString("en-US")}k`,
};

export const UNDERLYINGS: Underlying[] = [
  "Bitcoin",
  "Ether",
  "S&P 500",
  "Nasdaq-100",
  "EUR/USD",
  "USD/JPY",
];
export const onWhat = (family: string) => ON[family]?.on ?? family;
export const fmtValue = (family: string, x: number | null) =>
  x === null ? "–" : (ON[family]?.fmt ?? String)(x);
export const underlying = (family: string) => ON[family]?.under;
