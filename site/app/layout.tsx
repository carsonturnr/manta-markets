import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import AccountNav from "@/components/AccountNav";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Manta: prediction-market analytics",
  description:
    "Fair values, order books, cross-venue prices, costs to trade and accuracy for crypto, economics and financial contracts on Kalshi and Polymarket.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <ClerkProvider>
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
              <Link href="/tracker">BTC tracker</Link>
              <Link href="/stats">Accuracy</Link>
              <Link href="/quality">Data quality</Link>
              <AccountNav />
            </nav>
            {children}
            <footer>
              Manta · analytics for prediction markets: crypto, economics and financial contracts on
              Kalshi and Polymarket, with fair values from Deribit&apos;s options. Built on{" "}
              <a href="https://github.com/nautechsystems/nautilus_trader">NautilusTrader</a>. Data
              from the venues&apos; public APIs. Not investment advice.{" "}
              <Link href="/privacy">Privacy</Link>
            </footer>
          </main>
        </ClerkProvider>
      </body>
    </html>
  );
}
