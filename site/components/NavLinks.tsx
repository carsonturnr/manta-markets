"use client";
// The header's tools, with the current one marked (aria-current, which the CSS highlights). A
// client component only to read the current path. Names are for readers, not for us: the URLs
// stay as they were (/screener is "Markets", /stats is "Track record").
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; name: string; also?: string[] }[] = [
  { href: "/screener", name: "Markets", also: ["/contract", "/m/", "/c/"] },
  { href: "/compare", name: "Compare" },
  { href: "/distributions", name: "Forecasts", also: ["/liquidity"] },
  { href: "/stats", name: "Track record" },
];

function Nav({ path }: { path: string | null }) {
  const current = (l: (typeof LINKS)[number]) =>
    path !== null && [l.href, ...(l.also ?? [])].some((p) => path.startsWith(p));
  return (
    <nav aria-label="Tools">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l) ? "page" : undefined}>
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
