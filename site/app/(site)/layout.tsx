// The public site's frame: header, page, footer. The terminal (/terminal) has its own.
import Link from "next/link";
import { Suspense } from "react";
import AccountNav from "@/components/AccountNav";
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
          <Suspense fallback={<NavFallback />}>
            <NavLinks />
          </Suspense>
          {/* Search is the Markets page's text filter: a plain GET form, no JavaScript. */}
          <form action="/screener" className="search" role="search">
            <input type="text" name="q" placeholder="Search" aria-label="Search markets" />
            <kbd>/</kbd>
          </form>
          <AccountNav />
          <Link href="/terminal" className="btn btn-sm">
            Open terminal
          </Link>
        </div>
      </header>
      <main>{children}</main>
      <footer className="site-foot">
        <div className="in">
          <div className="foot-cols">
            <nav aria-label="Tools">
              <h2>01 Tools</h2>
              <Link href="/terminal">Terminal</Link>
              <Link href="/screener">Screener</Link>
              <Link href="/compare">Compare venues</Link>
              <Link href="/liquidity">Liquidity</Link>
            </nav>
            <nav aria-label="Analytics">
              <h2>02 Analytics</h2>
              <Link href="/distributions">Distributions</Link>
              <Link href="/replay">Replay a close</Link>
              <Link href="/tracker">Bitcoin fair value</Link>
            </nav>
            <nav aria-label="Research">
              <h2>03 Research</h2>
              <Link href="/stats">Fair-value accuracy</Link>
              <Link href="/quality">Data quality</Link>
            </nav>
            <nav aria-label="Account">
              <h2>04 Account</h2>
              <Link href="/account">Watchlist and alerts</Link>
              <Link href="/docs/api">API</Link>
              <Link href="/privacy">Privacy</Link>
            </nav>
          </div>
          <p>
            Prices from Kalshi&apos;s and Polymarket&apos;s public APIs; fair values from
            Deribit&apos;s options and both venues&apos; quotes. Built on{" "}
            <a href="https://github.com/nautechsystems/nautilus_trader">NautilusTrader</a>; charts
            by <a href="https://www.tradingview.com/">TradingView</a>&apos;s lightweight-charts. Not
            investment advice.
          </p>
          <div className="foot-mark" aria-hidden="true">
            Manta
          </div>
        </div>
      </footer>
    </>
  );
}
