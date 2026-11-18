// The landing page (step 10): what Manta is, the tools that are live, and the waitlist. Static:
// no database read, so it loads instantly and never fails.
import Link from "next/link";
import WaitlistForm from "@/components/WaitlistForm";

const TOOLS: { href: string; name: string; what: string }[] = [
  {
    href: "/screener",
    name: "Screener",
    what: "Every covered contract on Kalshi and Polymarket in one table, filtered by venue, category, expiry, spread, volume and distance from fair value. Each opens a contract page with its live book, trades, chart and rules.",
  },
  {
    href: "/compare",
    name: "Cross-venue",
    what: "The same event on both venues side by side, with what differs in how each settles, and where the prices cross after fees.",
  },
  {
    href: "/distributions",
    name: "Distributions",
    what: "Each ladder of strikes read as the market's probability distribution, and implied volatility by time to close, next to Deribit's options.",
  },
  {
    href: "/liquidity",
    name: "Liquidity",
    what: "Spreads and size at the best prices by family and hour; every contract page prices N contracts after slippage and fees.",
  },
  {
    href: "/replay",
    name: "Replay",
    what: "A past close minute by minute, rebuilt from our recordings of Kalshi's live order books, which Kalshi doesn't publish.",
  },
  {
    href: "/stats",
    name: "Accuracy",
    what: "How well each venue's prices and our fair values predicted what happened, scored with honest sample sizes.",
  },
  {
    href: "/quality",
    name: "Data quality",
    what: "What we record from each venue, coverage and gaps, and how the rebuilt order books check out.",
  },
];

export default function Landing() {
  return (
    <>
      <section className="hero">
        <h1>Analytics for prediction markets</h1>
        <p className="lede">
          Kalshi and Polymarket sell yes/no contracts on Bitcoin&apos;s price, the next CPI print or
          the Fed&apos;s decision. A contract&apos;s price is the crowd&apos;s probability. Manta
          shows what each contract is worth, where it&apos;s cheaper, how much is really available
          and what a trade would cost, for crypto, economics and financial contracts. No sports.
        </p>
        <p className="small">
          Fair values come from Deribit&apos;s options for Bitcoin and Ether, and from a consensus
          of both venues&apos; order books elsewhere, always labelled with their method. Every tool
          explains how it works on its own page.
        </p>
      </section>

      <h2>Join the waitlist</h2>
      <p className="small">
        The tools below are free to use now. Accounts with watchlists, alerts and an API come next;
        leave your email to hear when they open. One email address, nothing else.
      </p>
      <WaitlistForm />

      <h2>Live now</h2>
      <ul className="tools">
        {TOOLS.map((t) => (
          <li key={t.href}>
            <Link href={t.href}>{t.name}</Link>
            <span>{t.what}</span>
          </li>
        ))}
      </ul>
      <p className="small">
        Also: the original <Link href="/tracker">Bitcoin tracker</Link>, Kalshi&apos;s hourly
        Bitcoin contracts against the options market, once a minute.
      </p>
    </>
  );
}
