"use client";
// The home page's demo of the terminal: the layout tabs switch the grid in place instead of
// opening /terminal; a button in its header opens the full terminal on this contract and layout. Every panel the four layouts use is rendered once on the server; each carries
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
        {/* Always on show: the demo works in place, and this is how to get the real thing. */}
        <Link href={`/terminal?m=${encodeURIComponent(contract)}&layout=${layout}`} className="btn btn-sm pv-full">
          Open the full terminal →
        </Link>
      </header>
      {focus}
      {/* Market uses the demo's own smaller grid; the others are the terminal's (.t-grid-<name>). */}
      <div className={`t-grid ${layout === "market" ? "pv-grid-term" : `t-grid-${layout}`}`} data-layout={layout}>
        {children}
      </div>
    </div>
  );
}
