// The public site's frame: header, page, footer. The terminal (/terminal) has its own.
import Link from "next/link";
import { Suspense } from "react";
import AccountNav from "@/components/AccountNav";
import HeaderMenu from "@/components/HeaderMenu";
import Mark from "@/components/Mark";
import NavLinks, { NavFallback } from "@/components/NavLinks";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="site-header">
        <div className="in">
          <Link href="/" className="brand" aria-label="Manta, home">
            <Mark />
            Manta
          </Link>
          <HeaderMenu>
            <Suspense fallback={<NavFallback />}>
              <NavLinks />
            </Suspense>
            {/* Search is the Markets page's text filter: a plain GET form, no JavaScript. */}
            <form action="/markets" className="search" role="search">
              <input type="text" name="q" placeholder="Search" aria-label="Search markets" />
            </form>
            <AccountNav />
          </HeaderMenu>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-foot">
        <div className="in">
          <div className="foot-cols">
            <nav aria-label="Pages">
              <h2>Manta</h2>
              <Link href="/">Home</Link>
              <Link href="/markets">Markets</Link>
              <Link href="/insights">Insights</Link>
              <Link href="/how-its-built">How it&apos;s built</Link>
              <Link href="/terminal">Terminal</Link>
            </nav>
            <nav aria-label="More">
              <h2>More</h2>
              <Link href="/account">Account and alerts</Link>
              <Link href="/docs/api">API</Link>
              <Link href="/privacy">Privacy</Link>
              <a href="https://github.com/carsonturnr/manta-markets">Source code</a>
            </nav>
          </div>
          <p>
            Prices from Kalshi&apos;s and Polymarket&apos;s public APIs; fair values from
            Deribit&apos;s options and both venues&apos; quotes. Built on{" "}
            <a href="https://github.com/nautechsystems/nautilus_trader">NautilusTrader</a>; charts
            by <a href="https://www.tradingview.com/">TradingView</a>&apos;s lightweight-charts. Not
            investment advice.
          </p>
        </div>
      </footer>
    </>
  );
}
