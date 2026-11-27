"use client";
// Manta's mark as text, gliding over a slowly moving field of characters: decoration for the
// signed-out account page. Drawn on a canvas in Geist Mono, the mark in mint and the field in
// greys. Light on the CPU: 12 frames a second, paused when the tab is hidden or the art is off
// screen, and one still frame under prefers-reduced-motion.
import { useEffect, useRef } from "react";

// The mark: components/Mark.tsx's outline rasterised to a 60 x 19 grid of characters, denser
// characters where more of the cell is inside the shape. Sampled (scaled) onto the field below.
const ART = `
                             --
                            -@@-
                          :*@@@@*:
                        -#@@@@@@@@#-
                    .-*@@@@@@@@@@@@@@*-.
                 .=#@@@@@@@@@@@@@@@@@@@@#=.
              :+%@@@@@@@@@@@@@@@@@@@@@@@@@@%+:
           :+%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%+:
         -#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#-
       -%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%-
     .#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#.
    -@@@@@@@@@%#+-:..   .-#@@@@@@#-.   ..:-+#%@@@@@@@@@-
   =@@@@@@@#=.             +@@@@+             .=#@@@@@@@=
  -@@@@@%=.                 *@@*                 .=%@@@@@-
 .@@@@#-                     %@                     -#@@@@.
 +@@%-                       ++                       -%@@+
 %@#                         ..                         #@%
.@+                                                      +@.
 :                                                        :
`
  .slice(1, -1)
  .split("\n");
const ART_W = 60;
const ART_H = ART.length;
const RAMP = " .:-=+*#%@"; // lightest to densest
const FIELD = " .·:-=+"; // the field stays sparse, so the mark reads over it
const FPS = 12;
const CELL = 14; // px per character row

/** How much of an art cell is inside the mark, 0 to 1. */
const cover = (c: number, r: number) =>
  Math.max(0, RAMP.indexOf(ART[r]?.[c] ?? " ")) / (RAMP.length - 1);

export default function MantaAscii() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0;
    let rows = 0;
    let cw = 0;
    let raf = 0;
    let last = 0;
    let onScreen = true;

    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${CELL - 2}px ${getComputedStyle(canvas).fontFamily}`;
      ctx.textBaseline = "top";
      cw = ctx.measureText("M").width;
      cols = Math.ceil(width / cw);
      rows = Math.ceil(height / CELL);
    };

    const draw = (t: number) => {
      const s = t / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The mark: about 60% of the width, drifting in slow loops, its wings flexing a little.
      const mw = Math.max(24, Math.round(Math.min(cols * 0.62, rows * 2.6)));
      const mh = (mw / ART_W) * ART_H * 1.1;
      const cx = cols / 2 + Math.sin(s * 0.13) * cols * 0.05;
      const cy = rows * 0.45 + Math.sin(s * 0.21) * rows * 0.06;
      const flap = 1 + 0.07 * Math.sin(s * 0.9);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = (c - cx) / mw + 0.5;
          const v = (r - cy) / (mh * (1 + (flap - 1) * Math.abs(u - 0.5) * 2)) + 0.5;
          const k =
            u >= 0 && u < 1 && v >= 0 && v < 1
              ? cover(Math.floor(u * ART_W), Math.floor(v * ART_H))
              : 0;
          let ch: string;
          if (k > 0) {
            ch = RAMP[Math.round(k * (RAMP.length - 1))];
            ctx.fillStyle = k > 0.5 ? "#00ff77" : "rgba(0,255,119,0.55)";
          } else {
            // The field: ripples spreading from two drifting points, like water under the ray,
            // crossed by one slow diagonal swell. Their sum picks a character and a grey.
            const d1 = Math.hypot(
              c - cols * (0.3 + 0.1 * Math.sin(s * 0.11)),
              (r - rows * 0.7) * 2,
            );
            const d2 = Math.hypot(
              c - cols * (0.75 + 0.1 * Math.cos(s * 0.09)),
              (r - rows * 0.25) * 2,
            );
            const w =
              Math.sin(d1 * 0.22 - s * 1.1) +
              Math.sin(d2 * 0.18 - s * 0.8) +
              Math.sin((c - r * 2) * 0.05 + s * 0.4);
            const f = Math.max(0, (w - 0.3) / 2.7); // 0 to 1, the lower half of the range left blank
            ch = FIELD[Math.min(FIELD.length - 1, Math.floor(f * FIELD.length))];
            if (ch === " ") continue;
            ctx.fillStyle = `rgba(255,255,255,${(0.1 + f * 0.25).toFixed(2)})`;
          }
          ctx.fillText(ch, c * cw, r * CELL);
        }
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / FPS) return;
      last = t;
      draw(t);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      if (!still && onScreen && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const resize = new ResizeObserver(() => {
      size();
      draw(performance.now());
    });
    resize.observe(canvas);
    const seen = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      start();
    });
    seen.observe(canvas);
    document.addEventListener("visibilitychange", start);
    // Redraw once Geist Mono has loaded, so the grid is measured in the right font.
    document.fonts?.ready.then(() => {
      size();
      draw(performance.now());
    });
    start();
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return <canvas ref={ref} className="ascii" aria-hidden="true" />;
}
