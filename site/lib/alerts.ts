// Alert conditions (step 11): what each kind means, in words and as a check. The same rules run
// on the VM every minute (pricing/alerts.py); db/schema.sql (manta.alerts) defines the kinds.
// Prices are stored in dollars (0.05 = 5¢); the form takes cents, depth in contracts.

export const KINDS = ["above", "below", "spread", "depth", "venues"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  above: "Midpoint rises to",
  below: "Midpoint falls to",
  spread: "Spread widens to",
  depth: "Size at the best bid or ask drops under",
  venues: "Kalshi and Polymarket differ by",
};

/** "Midpoint at or above 60¢", "Depth under 100 contracts". */
export function describe(kind: Kind, threshold: number): string {
  const c = `${Math.round(threshold * 1000) / 10}¢`;
  switch (kind) {
    case "above":
      return `Midpoint at or above ${c}`;
    case "below":
      return `Midpoint at or below ${c}`;
    case "spread":
      return `Spread at least ${c}`;
    case "depth":
      return `Size at the best bid or ask under ${threshold.toLocaleString("en-US")} contracts`;
    case "venues":
      return `Kalshi and Polymarket midpoints at least ${c} apart`;
  }
}

/** The form's number (cents, or contracts for depth) as a stored threshold, or an error. */
export function parseThreshold(kind: Kind, raw: string): number | string {
  const x = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(x)) return "Enter a number.";
  if (kind === "depth") {
    if (!Number.isInteger(x) || x < 1 || x > 1_000_000)
      return "Enter a whole number of contracts from 1 to 1,000,000.";
    return x;
  }
  const [lo, hi] = kind === "above" || kind === "below" ? [1, 99] : [1, 98];
  if (x < lo || x > hi || Math.round(x * 10) !== x * 10)
    return `Enter cents from ${lo} to ${hi} (one decimal at most).`;
  return Math.round(x * 10) / 1000;
}
