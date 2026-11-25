"use client";
// The home page's demo of the terminal: the layout tabs switch the grid in place instead of
// opening /terminal; a click anywhere else opens /terminal on this contract and layout. Every panel the four layouts use is rendered once on the server; each carries
// the layouts it belongs to (data-layouts) and the CSS hides the rest.
import Link from "next/link";
import { useState, type ReactNode } from "react";

const LAYOUTS = [
  ["market", "Market"],
  ["monitor", "Monitor"],
  ["arb", "Cross-venue"],
  ["catalysts", "Catalysts"],
] as const;

export default function TerminalDemo({
  brand,
  focus,
  contract,
  children,
}: {
  brand: ReactNode;
  focus: ReactNode;
  contract: string; // "kalshi:TICKER", the terminal's ?m=
  children: ReactNode;
}) {
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number][0]>("market");
  return (
    <div className="terminal pv-terminal">
      <header className="t-top">
        {brand}
        <nav className="t-layouts" aria-label="Terminal layouts">
          {LAYOUTS.map(([k, name]) => (
            <button key={k} type="button" className={k === layout ? "on" : undefined} aria-pressed={k === layout} onClick={() => setLayout(k)}>
              {name}
            </button>
          ))}
        </nav>
      </header>
      {focus}
      {/* Market uses the demo's own smaller grid; the others are the terminal's (.t-grid-<name>). */}
      <div className={`t-grid ${layout === "market" ? "pv-grid-term" : `t-grid-${layout}`}`} data-layout={layout}>
        {children}
      </div>
      {/* Over the panels (the header and its tabs sit above it): the demo is a picture to open,
          not a second terminal to work in. */}
      <Link
        href={`/terminal?m=${encodeURIComponent(contract)}&layout=${layout}`}
        className="pv-open"
        aria-label="Open the terminal on this contract"
      >
        <span>Open the terminal →</span>
      </Link>
    </div>
  );
}
