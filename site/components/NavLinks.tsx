"use client";
// The header's links, with the current one marked (aria-current, which the CSS highlights). A
// client component to read the current path. The site's pages besides Home: the Market page
// (/m/…) is reached from Markets, so it marks Markets as current.
import Link from "next/link";
import { usePathname } from "next/navigation";

type L = { href: string; name: string; also?: string[] };

const LINKS: L[] = [
  { href: "/markets", name: "Markets", also: ["/m/", "/contract", "/c/"] },
  { href: "/insights", name: "Insights" },
  { href: "/how-its-built", name: "How it's built" },
  { href: "/terminal", name: "Terminal" },
];

const isCurrent = (path: string | null, l: L) =>
  path !== null && [l.href, ...(l.also ?? [])].some((p) => path.startsWith(p));

function Nav({ path }: { path: string | null }) {
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={isCurrent(path, l) ? "page" : undefined}>
          {l.name}
        </Link>
      ))}
    </nav>
  );
}

/** The links with none marked current: shown while the page streams in (the layout wraps
 * NavLinks in Suspense, which Next 16 requires of a component that reads the URL). */
export function NavFallback() {
  return <Nav path={null} />;
}

export default function NavLinks() {
  return <Nav path={usePathname()} />;
}
