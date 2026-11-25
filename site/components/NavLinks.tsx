"use client";
// The header's links, with the current one marked (aria-current, which the CSS highlights). A
// client component to read the current path and open the Pro tools menu. Three plain-language
// links first; the technical pages sit one level deeper under "Pro tools", each at its old URL.
// Fair value is one labelled tool there, never the pitch (positioning, AGENTS.md).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type L = { href: string; name: string; also?: string[] };

const LINKS: L[] = [
  { href: "/markets", name: "Markets", also: ["/contract", "/m/", "/c/"] },
  { href: "/compare", name: "Arbitrage" },
  { href: "/account", name: "Alerts" },
];

const PRO: L[] = [
  { href: "/terminal", name: "Terminal" },
  { href: "/screener", name: "Screener table" },
  { href: "/distributions", name: "Distributions" },
  { href: "/liquidity", name: "Liquidity" },
  { href: "/replay", name: "Replay" },
  { href: "/events", name: "Events" },
  { href: "/tracker", name: "Bitcoin fair value" },
  { href: "/stats", name: "Fair-value accuracy" },
  { href: "/quality", name: "Data quality" },
];

const isCurrent = (path: string | null, l: L) =>
  path !== null && [l.href, ...(l.also ?? [])].some((p) => path.startsWith(p));

const NavLink = ({ l, path }: { l: L; path: string | null }) => (
  <Link href={l.href} aria-current={isCurrent(path, l) ? "page" : undefined}>
    {l.name}
  </Link>
);

/** A disclosure menu: the button opens a list of links. Escape, a click outside or tabbing past
 * the last link closes it; following a link closes it too. On a phone the list is always shown
 * inside the Menu panel (CSS), so the button is hidden there. */
function ProTools({ path }: { path: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div
      ref={box}
      className="pro-tools"
      data-open={open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation(); // close this menu, not the phone menu around it
          setOpen(false);
          button.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="pro-tools-list"
        data-current={PRO.some((l) => isCurrent(path, l)) || undefined}
        onClick={() => setOpen(!open)}
      >
        Pro tools
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <div id="pro-tools-list" className="pro-tools-list">
        <span className="pro-tools-h" aria-hidden="true">
          Pro tools
        </span>
        {PRO.map((l) => (
          <NavLink key={l.href} l={l} path={path} />
        ))}
      </div>
    </div>
  );
}

function Nav({ path }: { path: string | null }) {
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => (
        <NavLink key={l.href} l={l} path={path} />
      ))}
      <ProTools path={path} />
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
