"use client";
// The header's links, search and account. On a wide screen they sit in a row (the wrapper is
// `display: contents`); on a phone they fold behind a Menu button, since they don't fit in one row.
import { useState, type ReactNode } from "react";

export default function HeaderMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls="header-menu"
        onClick={() => setOpen(!open)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {/* Following a link closes the menu: the layout stays mounted across pages. */}
      <div
        id="header-menu"
        className="header-menu"
        data-open={open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {children}
      </div>
    </>
  );
}
