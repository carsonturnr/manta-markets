// Resizable terminal grid: where the draggable borders go and how a drag changes the track sizes.
// Pure functions (tested in grid.test.ts); components/terminal/ResizableGrid.tsx does the browser part.

/** The window event the command bar's "Reset layout" fires (here, not in the client component,
 * so the server page can name it). */
export const RESET_EVENT = "manta:terminal-reset";

/** A border between two neighbouring tracks (columns or rows) that some panel edge sits on. */
export type Border = {
  axis: "col" | "row";
  i: number; // between track i and track i + 1
  from: number; // the first and last track across it (rows for a column border) with a real edge
  to: number;
  a: string; // the grid areas on either side at `from`, to name the separator
  b: string;
};

/** Parse the browser's computed grid-template-areas, `"mon chart" "mon book"`, into a matrix. */
export function parseAreas(css: string): string[][] {
  return [...css.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));
}

/** Every track border that separates two different panels somewhere along it. A border that runs
 * only through the middle of one panel (a chart spanning two columns) gets no handle there. */
export function borders(areas: string[][]): Border[] {
  const out: Border[] = [];
  const rows = areas.length;
  const cols = areas[0]?.length ?? 0;
  for (let i = 0; i + 1 < cols; i++) {
    const hits = areas.map((r, k) => (r[i] !== r[i + 1] ? k : -1)).filter((k) => k >= 0);
    if (hits.length)
      out.push({ axis: "col", i, from: hits[0], to: hits.at(-1)!, a: areas[hits[0]][i], b: areas[hits[0]][i + 1] });
  }
  for (let i = 0; i + 1 < rows; i++) {
    const hits = areas[i].map((x, k) => (x !== areas[i + 1][k] ? k : -1)).filter((k) => k >= 0);
    if (hits.length)
      out.push({ axis: "row", i, from: hits[0], to: hits.at(-1)!, a: areas[i][hits[0]], b: areas[i + 1][hits[0]] });
  }
  return out;
}

/** Move the border after track i by `delta` px: the two tracks beside it trade size, neither
 * going under `min` px, so the others (and the total) stay put. */
export function resize(sizes: number[], i: number, delta: number, min: number): number[] {
  const pair = sizes[i] + sizes[i + 1];
  const a = Math.min(Math.max(sizes[i] + delta, min), pair - min);
  const out = [...sizes];
  out[i] = a;
  out[i + 1] = pair - a;
  return out;
}
