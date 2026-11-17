import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Manta: Kalshi vs options",
  description:
    "Kalshi's Bitcoin contract prices next to the fair value implied by Deribit's options, live.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <main>
          <nav className="site-nav" aria-label="Site">
            <Link href="/" className="brand">
              Manta
            </Link>
            <Link href="/screener">Screener</Link>
            <Link href="/compare">Cross-venue</Link>
            <Link href="/distributions">Distributions</Link>
            <Link href="/liquidity">Liquidity</Link>
            <Link href="/replay">Replay</Link>
            <Link href="/">BTC tracker</Link>
            <Link href="/stats">Gap statistics</Link>
            <Link href="/quality">Data quality</Link>
          </nav>
          {children}
          <footer>
            Manta · analytics for prediction markets: crypto, economics and financial contracts on
            Kalshi and Polymarket, with fair values from Deribit&apos;s options. Built on{" "}
            <a href="https://github.com/nautechsystems/nautilus_trader">NautilusTrader</a>. Data
            from the venues&apos; public APIs. Not investment advice.
          </footer>
        </main>
      </body>
    </html>
  );
}
