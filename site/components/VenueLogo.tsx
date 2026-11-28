// The venue's own logo, to name where a contract trades. The files are the venues' official white
// marks, unchanged (kalshi.com/brandkit, polymarket.com/brand; Kalshi's kit forbids recolouring or
// cropping, and approves the white wordmark on black). Kalshi publishes only a wordmark, no icon.
import Image from "next/image";

// scale: Polymarket's logo is mostly its icon, so it is drawn taller for its wordmark to read at
// the size of Kalshi's.
const LOGOS = {
  kalshi: { src: "/venues/kalshi.svg", w: 300, h: 88, scale: 1, name: "Kalshi" },
  polymarket: { src: "/venues/polymarket.svg", w: 911, h: 168, scale: 1.35, name: "Polymarket" },
  // Compact rows: Polymarket's wordmark is unreadable at row height, its icon is not.
  polymarketIcon: { src: "/venues/polymarket-icon.svg", w: 512, h: 512, scale: 1.5, name: "Polymarket" },
} as const;

/** height: the Kalshi wordmark's height in px; the width follows each file's proportions. compact:
 * Polymarket's icon instead of its full logo, for list rows. */
export default function VenueLogo({ venue, height = 12, compact = false }: { venue: string; height?: number; compact?: boolean }) {
  const l = venue === "kalshi" ? LOGOS.kalshi : compact ? LOGOS.polymarketIcon : LOGOS.polymarket;
  const h = Math.round(height * l.scale);
  return <Image className="venue-logo" src={l.src} alt={l.name} width={Math.round((h * l.w) / l.h)} height={h} unoptimized />;
}
