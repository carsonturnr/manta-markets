"use client";
// The command bar: ⌘K (Ctrl+K on Windows) or "/" opens it; type to find any market or layout,
// Enter goes there (or, for an action such as "Reset layout", fires its window event). The market
// list is already on the page, so matching runs in the browser.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type Command = { label: string; hint: string; href?: string; event?: string };

export default function Palette({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .filter((c) => words.every((w) => `${c.label} ${c.hint}`.toLowerCase().includes(w)))
      .slice(0, 12);
  }, [commands, q]);

  const go = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    setQ("");
    if (c.event) window.dispatchEvent(new Event(c.event));
    if (c.href) router.push(c.href, { scroll: false });
  };

  return (
    <>
      <button type="button" className="t-cmd" onClick={() => setOpen(true)}>
        Find a market or panel <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="t-pal-back" onClick={() => setOpen(false)}>
          <div className="t-pal" role="dialog" aria-label="Command bar" onClick={(e) => e.stopPropagation()}>
            <input
              ref={input}
              type="text"
              value={q}
              placeholder="Bitcoin 5 pm, Fed December, CPI, layout…"
              onChange={(e) => {
                setQ(e.target.value);
                setI(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setI((x) => Math.min(x + 1, hits.length - 1));
                else if (e.key === "ArrowUp") setI((x) => Math.max(x - 1, 0));
                else if (e.key === "Enter") go(hits[i]);
              }}
            />
            <ul>
              {hits.map((c, k) => (
                <li key={`${c.label} ${c.href ?? ""}`}>
                  <button type="button" className={k === i ? "on" : ""} onMouseEnter={() => setI(k)} onClick={() => go(c)}>
                    <span>{c.label}</span>
                    <span className="t-dim">{c.hint}</span>
                  </button>
                </li>
              ))}
              {hits.length === 0 && <li className="t-empty">Nothing matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
