import type { Metadata } from "next";
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
          {children}
          <footer>
            Manta · Kalshi prices vs a fair value from Deribit&apos;s Bitcoin options. Built on{" "}
            <a href="https://github.com/nautechsystems/nautilus_trader">NautilusTrader</a>. Data
            from Kalshi and Deribit public APIs, snapshotted once a minute. Not investment advice.
          </footer>
        </main>
      </body>
    </html>
  );
}
