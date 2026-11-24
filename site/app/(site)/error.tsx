"use client";
// Shown in place of a page that failed to load, inside the site's header and footer. Most
// failures are a venue or our own data server being briefly unavailable (Kalshi rate limits,
// the replay server), so the first action offered is to try again.
import Link from "next/link";

export default function PageError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="state-page">
      <h1>This page didn&apos;t load</h1>
      <p className="lede">
        One of the sources it reads didn&apos;t answer in time. That is usually brief: try again
        in a few seconds.
      </p>
      <div className="state-actions">
        <button type="button" className="btn btn-sm" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/screener">Go to Markets</Link>
      </div>
    </div>
  );
}
