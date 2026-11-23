// The API's documentation (step 13, docs/plan-api.md). Static: no database reads.
import Link from "next/link";

export const metadata = { title: "Manta: API" };

const BASE = "https://mantamarkets.com/api/v1";

function Example({ path, response }: { path: string; response: string }) {
  return (
    <>
      <pre>
        <code>{`curl -H "Authorization: Bearer $MANTA_KEY" "${BASE}${path}"`}</code>
      </pre>
      <pre className="small">
        <code>{response}</code>
      </pre>
    </>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="wide">
      <h1>API</h1>
      <p>
        The numbers Manta&apos;s tools compute, as JSON: fair values, implied distributions, the cost
        of a trade, cross-venue gaps and liquidity statistics. Read-only. It serves our own analytics
        only, never the venues&apos; raw data: no order books, no trades, no bid and ask quotes. For
        those, use Kalshi&apos;s and Polymarket&apos;s own APIs.
      </p>

      <h2>Keys</h2>
      <p>
        Make a key on <Link href="/account">your account page</Link> (sign in first). It is shown
        once; we keep only a fingerprint (its SHA-256 hash), so a lost key can&apos;t be recovered:
        delete it and make another. Up to 3 keys per account. Send it in a header, never in the URL:
      </p>
      <pre>
        <code>Authorization: Bearer manta_…</code>
      </pre>

      <h2>Limits</h2>
      <p>
        60 units a minute per account, shared by all its keys. Every request costs 1 unit, except{" "}
        <code>/cost</code>, which costs 5 because it reads a venue&apos;s live order book. Each answer
        carries <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code> and{" "}
        <code>RateLimit-Reset</code> (seconds until the minute restarts). Over the limit the answer is
        429 with <code>Retry-After</code>. Live order-book reads are also capped across all API users
        together, so the API can&apos;t crowd out the site; when that cap is full,{" "}
        <code>/cost</code> answers 503 with <code>Retry-After: 1</code>.
      </p>

      <h2>Format</h2>
      <p>
        Every answer is <code>{`{ "data": …, "updated": "…" }`}</code>, where{" "}
        <code>updated</code> is when the numbers were computed. Prices and probabilities are in
        dollars per contract: 0.42 is 42¢, a 42% chance. Times are ISO 8601, UTC. Errors are{" "}
        <code>{`{ "error": "…" }`}</code> with status 400 (bad query), 401 (missing or unknown key),
        404, 429 or 503.
      </p>
      <p>
        Versioning: <code>/api/v1</code> only gains fields and endpoints. A change that renames or
        removes anything becomes <code>/api/v2</code>, and v1 stays up for at least three months with
        a notice here.
      </p>

      <h2>GET /fair-values</h2>
      <p>
        Every open contract with a fair value: what we think a &quot;yes&quot; is worth, and how it
        was worked out. <code>method</code> is <code>options</code> (Bitcoin and Ether, from
        Deribit&apos;s options), <code>consensus-2</code> (both venues&apos; quotes, weighted by
        depth, net of fees) or <code>consensus-1</code> (one venue&apos;s quotes). Optional filters:{" "}
        <code>venue</code>, <code>family</code>, <code>event</code>. Refreshed every minute. Method:{" "}
        <Link href="/tracker">fair value</Link>.
      </p>
      <Example path="/fair-values?family=KXBTCD" response={`{"data":[{"venue":"kalshi","id":"KXBTCD-…","family":"KXBTCD",
  "event":"KXBTCD-…","label":"$97,000 or above","payoff":"above","low":97000,"high":null,
  "close":"2026-11-23T22:00:00.000Z","fair":0.412,"method":"options"}, …],
 "updated":"2026-11-23T17:01:04.000Z"}`} />

      <h2>GET /distributions</h2>
      <p>
        Each ladder of strikes read as the market&apos;s probability distribution for one number (a
        price at a time, a CPI print, the Fed&apos;s rate): median and quartiles,{" "}
        <code>mean</code> and <code>sd</code> (standard deviation), the volatility it implies and,
        for crypto, Deribit&apos;s. <code>curve</code> is the fitted chance the value ends above
        each <code>x</code>, as <code>[x, P(value &gt; x)]</code>. Optional filters:{" "}
        <code>family</code>, <code>event</code>. Method:{" "}
        <Link href="/distributions">distributions</Link>.
      </p>

      <h2>GET /cost</h2>
      <p>
        What buying or selling <code>n</code> contracts costs right now, as a taker: the venue&apos;s
        live order book walked level by level, plus its fee. Query: <code>venue</code> (
        <code>kalshi</code> or <code>polymarket</code>), <code>id</code> (as in{" "}
        <code>/fair-values</code>), <code>side</code> (<code>buy</code>, the default, or{" "}
        <code>sell</code>), <code>n</code> (1 to 100,000). The answer gives{" "}
        <code>best_price</code>, the top of the book when the calculation ran (at{" "}
        <code>book_time</code>; the book is at most a few seconds old), the{" "}
        <code>average_price</code>, <code>slippage</code> (how much worse the average is than the
        best price), <code>value</code> before fees, <code>fee</code>, <code>total</code> and{" "}
        <code>per_contract</code>. <code>filled</code> is less than <code>n</code> when the book is
        too thin. When we don&apos;t know the venue&apos;s fee for a contract, the fee and totals are
        null. Dollar amounts (<code>value</code>, <code>fee</code>, <code>total</code>) are rounded
        to the venue&apos;s own fee precision: $0.0001 on Kalshi, $0.00001 on Polymarket. Prices,{" "}
        <code>slippage</code> and <code>per_contract</code> are rounded to 6 decimals. Costs 5
        units, even when the query is rejected (400); a request without a valid key gets 401 first.
      </p>

      <h2>GET /pairs</h2>
      <p>
        The same question on Kalshi and Polymarket. <code>gap_cents</code> is how far apart the
        venues are: for one contract against one, the difference of their midpoints; against a
        bundle of Polymarket buckets, how far Kalshi&apos;s midpoint lies outside the bundle&apos;s
        bid–ask range (0 inside). <code>crossing</code> is set when one venue&apos;s ask is below the
        other&apos;s bid: the cents locked in per contract before fees, and <code>net_cents</code>{" "}
        after both legs&apos; taker fees (null if a fee is unknown). Method:{" "}
        <Link href="/compare">compare venues</Link>.
      </p>

      <h2>GET /liquidity</h2>
      <p>
        Per contract family, sampled every 15 minutes over active contracts (quoted on both sides,
        midpoint 5¢–95¢): the median spread and the median size at the best prices, and the median
        spread by hour of day (UTC) over the last 14 days. Method:{" "}
        <Link href="/liquidity">liquidity</Link>.
      </p>
    </div>
  );
}
