"use client";
// The terminal's panel grid with draggable borders. The layout's CSS (.t-grid-<name>) sets the
// starting tracks; this measures them, lays a separator over each border between two panels, and
// on drag (or arrow keys, 16 px a press, 64 with Shift) sets the column and row sizes inline.
// Sizes are kept per layout in localStorage; the command bar's "Reset layout" clears them.
// Below 1100 px the panels stack (globals.css), which overrides these sizes and hides the handles.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { borders, parseAreas, RESET_EVENT, resize, type Border } from "@/lib/grid";

const MIN = 120; // px: the smallest a column or row can get, enough for a panel header and a few lines
const GAP = 1; // px: the hairline between panels (.t-grid gap)

type Tracks = { cols: number[]; rows: number[] };
const px = (css: string) => css.split(" ").map(parseFloat);
const template = (t: number[]) => t.map((w) => `minmax(0, ${w}fr)`).join(" ");
const offset = (t: number[], n: number) => t.slice(0, n).reduce((s, x) => s + x + GAP, 0);

export default function ResizableGrid({
  layout,
  className,
  names,
  children,
}: {
  layout: string;
  className: string;
  names: Record<string, string>; // panel area → title, for the separators' labels
  children: ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const key = `manta.terminal.grid.${layout}`;
  const [custom, setCustom] = useState<Tracks | null>(null); // null: the layout's CSS sizes
  const [m, setM] = useState<Tracks & { areas: string[][] }>(); // tracks as drawn, in px
  const drag = useRef<{ start: number; base: number[] } | null>(null);

  // Measure the drawn tracks whenever the grid or any panel changes size.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = getComputedStyle(el);
      setM({ cols: px(s.gridTemplateColumns), rows: px(s.gridTemplateRows), areas: parseAreas(s.gridTemplateAreas) });
    });
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Saved sizes for this layout, kept only if they still match its number of tracks.
  useEffect(() => {
    const onReset = () => {
      localStorage.removeItem(key);
      setCustom(null);
    };
    window.addEventListener(RESET_EVENT, onReset);
    try {
      const t = JSON.parse(localStorage.getItem(key) ?? "null") as Tracks | null;
      const s = grid.current && getComputedStyle(grid.current);
      if (t && s && t.cols.length === px(s.gridTemplateColumns).length && t.rows.length === px(s.gridTemplateRows).length)
        setCustom(t); // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    } catch {
      localStorage.removeItem(key);
    }
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, [key]);

  const apply = (b: Border, base: number[], delta: number, save: boolean) => {
    if (!m || (delta === 0 && !custom)) return; // a click on a handle keeps the layout's own sizes
    const next = resize(base, b.i, delta, MIN);
    const t = b.axis === "col" ? { cols: next, rows: custom?.rows ?? m.rows } : { cols: custom?.cols ?? m.cols, rows: next };
    setCustom(t);
    if (save) localStorage.setItem(key, JSON.stringify(t));
  };

  const onPointerDown = (e: PointerEvent, b: Border) => {
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: b.axis === "col" ? e.clientX : e.clientY, base: m[`${b.axis}s`] };
  };
  const onPointerMove = (e: PointerEvent, b: Border, save = false) => {
    if (!drag.current) return;
    apply(b, drag.current.base, (b.axis === "col" ? e.clientX : e.clientY) - drag.current.start, save);
    if (save) drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent, b: Border) => {
    const [less, more] = b.axis === "col" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!m || (e.key !== less && e.key !== more)) return;
    e.preventDefault();
    apply(b, m[`${b.axis}s`], (e.key === more ? 1 : -1) * (e.shiftKey ? 64 : 16), true);
  };

  return (
    <div
      ref={grid}
      className={`${className} t-resizable`}
      style={custom ? { gridTemplateColumns: template(custom.cols), gridTemplateRows: template(custom.rows) } : undefined}
    >
      {children}
      {m &&
        borders(m.areas).map((b) => {
          const [along, across] = b.axis === "col" ? [m.cols, m.rows] : [m.rows, m.cols];
          const at = offset(along, b.i + 1) - GAP / 2; // the middle of the hairline
          const start = offset(across, b.from);
          const length = offset(across, b.to + 1) - GAP - start;
          const share = Math.round((along[b.i] / (along[b.i] + along[b.i + 1])) * 100);
          return (
            <div
              key={`${b.axis}${b.i}`}
              role="separator"
              tabIndex={0}
              aria-orientation={b.axis === "col" ? "vertical" : "horizontal"}
              aria-label={`Resize ${names[b.a] ?? b.a} and ${names[b.b] ?? b.b}`}
              aria-valuenow={share}
              aria-valuemin={0}
              aria-valuemax={100}
              className={`t-sep t-sep-${b.axis}`}
              style={b.axis === "col" ? { left: at, top: start, height: length } : { top: at, left: start, width: length }}
              onPointerDown={(e) => onPointerDown(e, b)}
              onPointerMove={(e) => onPointerMove(e, b)}
              onPointerUp={(e) => onPointerMove(e, b, true)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={(e) => onKeyDown(e, b)}
            />
          );
        })}
    </div>
  );
}
