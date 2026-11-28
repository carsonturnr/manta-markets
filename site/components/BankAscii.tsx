"use client";
// A classical exchange building (pediment, six fluted columns, steps) on a night plain with low
// hills behind: decoration for the signed-out account page. One still frame drawn on a canvas,
// redrawn only when its box changes size, so there is no motion to reduce.
//
// The scene is a brightness function over the whole plane (sky, hills and ground go on forever),
// and the building is scaled to fit the box: a wide phone strip or a tall desktop half both show
// the whole building, with more sky or ground around it rather than a crop through it.
import { useEffect, useRef } from "react";

const MINT = "0,255,119";

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
// A fixed pseudo-random number per grid point, for stars.
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const HORIZON = 0.76;
const COLS = [-0.55, -0.33, -0.11, 0.11, 0.33, 0.55];

/** Brightness 0 to 1 at a point; x runs -1 to 1 across the building, y 0 to 1 from its top. */
export function scene(x: number, y: number): number {
  const ax = Math.abs(x);

  // Steps: three, each wider than the one above, lit on the tread and dimmer on the riser.
  for (let i = 0; i < 3; i++) {
    const top = 0.7 + i * 0.02;
    if (y >= top && y < top + 0.02 && ax < 0.66 + i * 0.035) {
      return y < top + 0.005 ? 0.9 : 0.42 - i * 0.06;
    }
  }

  // Columns, with their capitals and bases, in front of the dark porch.
  if (y >= 0.42 && y < 0.7 && ax < 0.66) {
    for (const cx of COLS) {
      const d = x - cx;
      if (y < 0.445 && Math.abs(d) < 0.075) return y < 0.432 ? 0.85 : 0.55; // capital
      if (y >= 0.68 && Math.abs(d) < 0.07) return y < 0.688 ? 0.75 : 0.5; // base
      // The shaft narrows a little towards the top.
      const hw = 0.052 - 0.008 * ((0.68 - y) / 0.24);
      if (y >= 0.445 && y < 0.68 && Math.abs(d) < hw) {
        const s = d / hw; // -1 to 1 across the shaft
        const z = Math.sqrt(1 - s * s);
        const lit = Math.max(0, -0.55 * s + 0.83 * z); // light from the upper left
        const flute = 0.78 + 0.22 * Math.abs(Math.cos(Math.asin(s) * 5));
        return (0.1 + 0.85 * lit) * flute;
      }
    }
    // The porch behind the columns, with a darker doorway in the middle.
    if (ax < 0.09 && y > 0.5) return ax > 0.08 || y < 0.508 ? 0.3 : 0.015;
    return 0.06;
  }

  // Entablature: cornice, frieze with triglyph slots, architrave.
  if (y >= 0.36 && y < 0.42 && ax < (y < 0.372 ? 0.72 : 0.68)) {
    if (y < 0.372) return 0.95;
    if (y < 0.395) return Math.abs(((x + 1) / 0.055) % 2 - 1) < 0.25 ? 0.25 : 0.55;
    return 0.72;
  }

  // Pediment: a lit raking cornice around a dim tympanum with a round medallion.
  if (y >= 0.2 && y < 0.36) {
    const edge = 0.2 + (ax / 0.72) * 0.16; // the sloped roof line at this x
    if (y >= edge) {
      if (y < edge + 0.016) return 0.92;
      if (Math.hypot(x, (y - 0.315) * 1.2) < 0.03) return 0.6;
      return 0.2;
    }
  }

  // Ground: a lit path from the steps towards the viewer, paved in rows that close up with
  // distance, on a dark plain. Both fade out towards the bottom, so the building stays the subject.
  if (y >= HORIZON) {
    const g = y - HORIZON;
    const fade = 1 - smooth(0.02, 0.3, g);
    if (ax < 0.2 + g * 1.6) {
      const row = (1 / (g + 0.03)) % 1;
      return row < 0.15 ? 0 : 0.24 * fade;
    }
    return 0.02 * fade;
  }

  // Two ranges of low hills on the horizon, the nearer one darker.
  const near = 0.69 + 0.035 * Math.sin(x * 2.3 + 1.2) + 0.015 * Math.sin(x * 6.1);
  if (y > near) return 0.03;
  const far = 0.66 + 0.03 * Math.sin(x * 3.7 + 4) + 0.012 * Math.sin(x * 9.3 + 2);
  if (y > far) return 0.09;

  // Sky: black overhead, glowing towards the horizon, with a few stars.
  const gx = Math.floor(x * 90);
  const gy = Math.floor(y * 90);
  if (y < 0.55 && hash(gx, gy) > 0.995) return 0.7;
  return 0.24 * smooth(0.3, HORIZON, y) ** 2;
}

// Ordered dither: Bayer's 8 x 8 threshold matrix, so flat areas break into an even dot pattern.
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60,
  28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47,
  7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];
const RAMP = " .:-=+*#%@"; // lightest to densest
const DOT = 2; // px per dither dot
const CELL = 11; // px per ASCII row

export default function BankAscii({ variant = "dither" }: { variant?: "dither" | "ascii" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const { width: w, height: h } = canvas.getBoundingClientRect();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Fit the building (x -0.75 to 0.75, y 0.18 to 0.8) with a margin, centred.
      const k = Math.min(w / 1.65, h / 0.8);
      const toX = (px: number) => (px - w / 2) / k;
      const toY = (py: number) => (py - h / 2) / k + 0.49;

      if (variant === "dither") {
        ctx.fillStyle = `rgb(${MINT})`;
        // Start 24 px down, so no star sits against the header's rule.
        for (let r = 24 / DOT; r * DOT < h; r++) {
          for (let c = 0; c * DOT < w; c++) {
            const b = scene(toX(c * DOT + DOT / 2), toY(r * DOT + DOT / 2));
            if (b * 64 > BAYER[(r % 8) * 8 + (c % 8)] + 0.5) ctx.fillRect(c * DOT, r * DOT, DOT, DOT);
          }
        }
        return;
      }
      ctx.font = `${CELL - 1}px ${getComputedStyle(canvas).fontFamily}`;
      ctx.textBaseline = "top";
      const cw = ctx.measureText("M").width;
      for (let r = 0; r * CELL < h; r++) {
        for (let c = 0; c * cw < w; c++) {
          // Average a 4 x 4 grid of samples, so thin lines (the roof's edge) still register.
          let b = 0;
          for (let i = 0; i < 16; i++) {
            b += scene(toX((c + ((i % 4) + 0.5) / 4) * cw), toY((r + (Math.floor(i / 4) + 0.5) / 4) * CELL));
          }
          b /= 16;
          const ch = RAMP[Math.min(RAMP.length - 1, Math.round(b * (RAMP.length - 1)))];
          if (ch === " ") continue;
          ctx.fillStyle = `rgba(${MINT},${(0.3 + 0.7 * b).toFixed(2)})`;
          ctx.fillText(ch, c * cw, r * CELL);
        }
      }
    };

    const resize = new ResizeObserver(draw);
    resize.observe(canvas);
    document.fonts?.ready.then(draw); // measure the grid in Geist Mono once it has loaded
    return () => resize.disconnect();
  }, [variant]);

  return <canvas ref={ref} className="ascii" aria-hidden="true" />;
}
