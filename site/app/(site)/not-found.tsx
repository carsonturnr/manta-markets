// A page or contract that doesn't exist (pages call notFound() for unknown tickers), inside the
// site's header and footer. app/not-found.tsx reuses it for URLs that match no route.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="state-page">
      <h1>Nothing here</h1>
      <p className="lede">
        This market may have closed and dropped out of the listing, or the address is mistyped.
      </p>
      <div className="state-actions">
        <Link href="/markets" className="btn btn-sm">
          Search the markets
        </Link>
        <Link href="/" className="btn btn-sm btn-ghost">
          Home
        </Link>
      </div>
    </div>
  );
}
