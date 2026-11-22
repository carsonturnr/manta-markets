import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import ClerkFirst from "@/components/ClerkFirst";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
// Headlines only: an editorial serif, set large and tight.
const serif = Newsreader({ variable: "--font-serif", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Manta: prediction-market analytics",
  description:
    "Fair values, order books, cross-venue prices, costs to trade and accuracy for crypto, economics and financial contracts on Kalshi and Polymarket.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <ClerkFirst>
          <ClerkProvider>{children}</ClerkProvider>
        </ClerkFirst>
      </body>
    </html>
  );
}
