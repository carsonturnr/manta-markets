"use client";
// The header's links, with the current one marked (aria-current, which the CSS highlights). A
// client component to read the current path and open the Tools menu. Three plain-language
// links first; the technical pages sit one level deeper under "Tools", each at its old URL.
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

// Each tool with a sentence and a small drawing of what it shows: lines and boxes in the page's
// greys, mint where Manta's own figure sits. viewBox 64 × 40.
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.2 } as const;
const M = { fill: "none", stroke: "var(--mint)", strokeWidth: 1.4 } as const;

const PRO: (L & { text: string; art: React.ReactNode })[] = [
  {
    href: "/terminal",
    name: "Terminal",
    text: "Chart, order book and trades for one contract, live, on one screen.",
    art: (
      <>
        <rect x="4" y="4" width="34" height="32" {...S} />
        <rect x="42" y="4" width="18" height="15" {...S} />
        <rect x="42" y="21" width="18" height="15" {...S} />
        <path d="M8 28 15 22 21 25 28 14 34 17" {...M} />
      </>
    ),
  },
  {
    href: "/screener",
    name: "Screener table",
    text: "Every contract in one sortable table, filtered by venue, category and close.",
    art: (
      <>
        <path d="M4 8H60M4 16H60M4 24H60M4 32H60" {...S} />
        <path d="M22 5V35M42 5V35" {...S} strokeDasharray="2 2" />
      </>
    ),
  },
  {
    href: "/distributions",
    name: "Distributions",
    text: "What a ladder of prices says the likeliest result is, and how sure traders are.",
    art: (
      <>
        <path d="M6 35H58" {...S} />
        {[4, 9, 17, 26, 30, 24, 15, 8, 4].map((h, i) => (
          <rect key={i} x={8 + i * 5.4} y={34 - h} width="3.6" height={h} fill="currentColor" />
        ))}
        <path d="M32 4V35" {...M} />
      </>
    ),
  },
  {
    href: "/liquidity",
    name: "Liquidity",
    text: "How wide prices are and how much you can trade, by hour of day.",
    art: (
      <>
        {Array.from({ length: 18 }, (_, i) => (
          <rect
            key={i}
            x={6 + (i % 6) * 9}
            y={6 + Math.floor(i / 6) * 10}
            width="7"
            height="8"
            fill="currentColor"
            opacity={[0.25, 0.5, 0.9, 0.4, 0.2, 0.6][(i * 7) % 6]}
          />
        ))}
      </>
    ),
  },
  {
    href: "/replay",
    name: "Replay",
    text: "Watch any recorded close again, minute by minute: the book, the trades, the price.",
    art: (
      <>
        <path d="M4 26 14 22 22 27 32 15 42 19 50 9 60 12" {...S} />
        <path d="M4 35H60" {...S} />
        <path d="M32 35V8" {...M} strokeDasharray="2 2" />
      </>
    ),
  },
  {
    href: "/events",
    name: "Events",
    text: "How prices moved when jobs, inflation and Fed numbers came out.",
    art: (
      <>
        <path d="M4 28H30V12H60" {...S} />
        <path d="M30 4V36" {...M} />
      </>
    ),
  },
  {
    href: "/tracker",
    name: "Bitcoin fair value",
    text: "Our estimate for Kalshi's Bitcoin contracts from options prices, beside Kalshi's own.",
    art: (
      <>
        <path d="M4 30 14 24 24 26 34 16 44 18 54 10 60 11" {...S} />
        <path d="M4 27 14 25 24 23 34 19 44 16 54 13 60 12" {...M} strokeDasharray="3 2" />
      </>
    ),
  },
  {
    href: "/stats",
    name: "Fair-value accuracy",
    text: "How often our estimates and the venues' prices turned out right.",
    art: (
      <>
        <path d="M6 36 58 4" {...S} strokeDasharray="2 2" />
        {[12, 20, 28, 36, 44, 52].map((x, i) => (
          <circle key={x} cx={x} cy={[31, 27, 20, 17, 11, 9][i]} r="2" fill="var(--mint)" />
        ))}
      </>
    ),
  },
  {
    href: "/quality",
    name: "Data quality",
    text: "Gaps and coverage in our recordings of each venue's feed.",
    art: (
      <>
        {[10, 20, 30].map((y) => (
          <path key={y} d={`M4 ${y}H60`} {...S} strokeWidth="5" opacity={0.5} />
        ))}
        <path d="M38 20H43" stroke="var(--bg)" strokeWidth="6" />
      </>
    ),
  },
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
        Tools
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <div id="pro-tools-list" className="pro-tools-list">
        <span className="pro-tools-h" aria-hidden="true">
          Tools
        </span>
        {PRO.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="tool-item"
            aria-current={isCurrent(path, l) ? "page" : undefined}
          >
            <svg className="tool-thumb" viewBox="0 0 64 40" aria-hidden="true">
              {l.art}
            </svg>
            <span>
              <b>{l.name}</b>
              <span>{l.text}</span>
            </span>
          </Link>
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
