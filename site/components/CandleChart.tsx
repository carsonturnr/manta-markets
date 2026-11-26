"use client";
// The contract page's price chart: candles (or a line) with volume, Kalshi's bid and ask, and our
// fair value where we have one, drawn with TradingView's lightweight-charts (Apache-2.0). Its logo is off:
// the licence's link to tradingview.com is in the site footer and the terminal's status bar.
// Attribution notice: TradingView Lightweight Charts™, Copyright (c) 2025 TradingView, Inc.
// https://www.tradingview.com/ The library does the drawing, zoom, pan and crosshair;
// this file picks the data and the toolbar.
//
// Prices stay probabilities (0 to 1) and are shown as a percent chance (a 37¢ contract: 37%). Times are UTC: the library shows the
// unix seconds it's given without converting them to the viewer's time zone.
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  AreaSeries,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Bar, defaultMinutes, fill, group, type KalshiCandle, midBars, tradeBars } from "@/lib/candles";

// Each timeframe is regrouped from one of the two resolutions the server fetched.
const FRAMES = [
  { label: "1m", minutes: 1, from: "m1" },
  { label: "5m", minutes: 5, from: "m1" },
  { label: "15m", minutes: 15, from: "m1" },
  { label: "1h", minutes: 60, from: "h1" },
  { label: "4h", minutes: 240, from: "h1" },
] as const;
type Frame = (typeof FRAMES)[number];

type Props = {
  kalshi?: { m1: KalshiCandle[]; h1: KalshiCandle[] }; // bid, ask and trades
  poly?: { m1: Bar[]; h1: Bar[] }; // one price per period, no volume
  fair?: { t: number; fair: number }[]; // ms, probability: our options-implied fair value
  close?: number; // unix ms: the contract's close; flat bars are drawn up to it (or to now)
};

const cents = (p: number) => `${(Math.round(p * 1000) / 10).toFixed(1)}%`;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const ts = (s: number) => s as UTCTimestamp;
/** A "#rrggbb" (or "#rgb") token as rgba with this opacity: the chart library draws on a canvas and doesn't
 * read CSS colour functions. */
const alpha = (hex: string, a: number) => {
  // The CSS minifier may shorten "#00ff77" to "#0f7": double each digit back to six.
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  const n = Number.parseInt(h, 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export default function CandleChart({ kalshi, poly, fair, close }: Props) {
  // Open on the bar length that suits the contract's life (hourly: 1m, daily: 15m, longer: 1h).
  const [frame, setFrame] = useState<Frame>(() => {
    // The hourly history reaches back further than the 1-minute one, so it measures the life.
    const span = Math.max(...[kalshi?.m1, kalshi?.h1, poly?.m1, poly?.h1].map((bs) => (bs?.length ? bs[bs.length - 1].time - bs[0].time : 0)));
    const want = defaultMinutes(span);
    return FRAMES.find((f) => f.minutes === want) ?? FRAMES[1];
  });
  const [source, setSource] = useState<"mid" | "trades">("mid");
  const [kind, setKind] = useState<"candles" | "line">("candles");
  const [show, setShow] = useState({ fair: true, quotes: false, volume: true });
  const [hover, setHover] = useState<Bar | null>(null);
  // Where the pointer is over the chart, for the hover card; null when it's off the chart.
  const [at, setAt] = useState<{ x: number; y: number; w: number } | null>(null);

  // Flat bars run to the close, or to when the chart opened while the contract is still open (unix
  // seconds, whole minute). Captured once: newer candles from a refresh still draw after it.
  const [openedAt] = useState(() => Date.now());
  const end = Math.floor(Math.min(close ?? openedAt, openedAt) / 60_000) * 60;
  // The bars for the chosen timeframe, plus the bid and ask at each bar's close (Kalshi only).
  const { bars, quotes } = useMemo(() => {
    if (kalshi) {
      const raw = kalshi[frame.from];
      const base = source === "mid" ? midBars(raw) : tradeBars(raw);
      const step = frame.minutes * 60;
      const last = new Map<number, KalshiCandle>(); // the last raw candle in each period
      for (const c of raw) last.set(Math.floor(c.time / step) * step, c);
      return {
        // Mid candles are continuous (Kalshi skips unchanged minutes: fill draws them flat);
        // trade candles keep their gaps, since a minute without a trade has no traded price.
        bars: source === "mid" ? fill(group(base, frame.minutes), frame.minutes, end) : group(base, frame.minutes),
        quotes: [...last].map(([time, c]) => ({ time, bid: c.bid[3], ask: c.ask[3] })),
      };
    }
    return { bars: poly ? fill(group(poly[frame.from], frame.minutes), frame.minutes, end) : [], quotes: [] };
  }, [kalshi, poly, frame, source, end]);

  // Our fair value, one point per period (the last in it), within the bars' time span.
  const fairLine = useMemo(() => {
    if (!fair || bars.length === 0) return [];
    const step = frame.minutes * 60;
    const byPeriod = new Map<number, number>();
    for (const p of fair) byPeriod.set(Math.floor(p.t / 1000 / step) * step, p.fair);
    return [...byPeriod]
      .filter(([time]) => time >= bars[0].time)
      .map(([time, value]) => ({ time: ts(time), value }));
  }, [fair, bars, frame]);

  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{
    candles: ISeriesApi<"Candlestick">;
    line: ISeriesApi<"Area">;
    volume: ISeriesApi<"Histogram">;
    bid: ISeriesApi<"Line">;
    ask: ISeriesApi<"Line">;
    fair: ISeriesApi<"Line">;
  } | null>(null);

  // Create the chart once; colours come from the site's CSS tokens.
  useEffect(() => {
    if (!box.current) return;
    // The scale pads above and below the data; a price outside 0–100¢ can't happen, so no label.
    const label = (p: number) => (p < -1e-9 || p > 1 + 1e-9 ? "" : cents(p));
    const priceFormat = { type: "custom" as const, formatter: label, minMove: 0.001 };
    // Probabilities can't leave 0–100¢, so the scale never shows a negative price.
    const clamp = (
      original: () => { priceRange: { minValue: number; maxValue: number } } | null,
    ) => {
      const r = original();
      if (r) {
        r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
        r.priceRange.maxValue = Math.min(1, r.priceRange.maxValue);
      }
      return r;
    };
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--text-3"),
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line"), scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { borderColor: css("--line"), timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") },
        horzLine: { color: css("--line-2"), labelBackgroundColor: css("--panel-2") },
      },
    });
    const up = css("--up");
    const down = css("--down");
    const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    const quote = { ...quiet, color: css("--kalshi"), lineWidth: 1 as const, lineStyle: LineStyle.Dashed, priceFormat };
    series.current = {
      volume: c.addSeries(HistogramSeries, { ...quiet, priceScaleId: "volume", priceFormat: { type: "volume" } }),
      bid: c.addSeries(LineSeries, quote),
      ask: c.addSeries(LineSeries, quote),
      candles: c.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderVisible: false,
        priceFormat,
        autoscaleInfoProvider: clamp,
      }),
      // The line view: the market price as a filled area in the market grey, fading to nothing.
      line: c.addSeries(AreaSeries, {
        lineColor: css("--ink"),
        topColor: alpha(css("--ink"), 0.18),
        bottomColor: alpha(css("--ink"), 0),
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat,
        autoscaleInfoProvider: clamp,
      }),
      fair: c.addSeries(LineSeries, {
        color: css("--fair"),
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat,
      }),
    };
    // Volume sits in the bottom fifth, on its own scale.
    c.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  // The crosshair's bar for the readout; the newest bar when the pointer is off the chart.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const byTime = new Map(bars.map((b) => [b.time, b]));
    const onMove = (p: { time?: unknown; point?: { x: number; y: number } }) => {
      const bar = byTime.get(p.time as number) ?? null;
      setHover(bar);
      setAt(bar && p.point ? { ...p.point, w: c.paneSize().width } : null);
    };
    c.subscribeCrosshairMove(onMove);
    return () => c.unsubscribeCrosshairMove(onMove);
  }, [bars]);

  // Data in. The page refreshes every few seconds; keep the reader's zoom unless the timeframe
  // changed, in which case show the latest ~120 bars.
  const lastFrame = useRef<Frame | null>(null);
  useEffect(() => {
    const s = series.current;
    const c = chart.current;
    if (!s || !c) return;
    const kept = lastFrame.current === frame ? c.timeScale().getVisibleLogicalRange() : null;
    const data = bars.map((b) => ({ ...b, time: ts(b.time) }));
    s.candles.setData(kind === "candles" ? data : []);
    s.line.setData(kind === "line" ? data.map((b) => ({ time: b.time, value: b.close })) : []);
    s.volume.setData(
      show.volume && kalshi
        ? data.map((b) => ({
            time: b.time,
            value: b.volume,
            color: alpha(css(b.close >= b.open ? "--up" : "--down"), 0.35),
          }))
        : [],
    );
    s.bid.setData(show.quotes ? quotes.map((q) => ({ time: ts(q.time), value: q.bid })) : []);
    s.ask.setData(show.quotes ? quotes.map((q) => ({ time: ts(q.time), value: q.ask })) : []);
    s.fair.setData(show.fair ? fairLine : []);
    if (kept) c.timeScale().setVisibleLogicalRange(kept);
    else if (bars.length < 120) c.timeScale().fitContent(); // a young contract: show it all
    else c.timeScale().setVisibleLogicalRange({ from: bars.length - 120, to: bars.length + 2 });
    lastFrame.current = frame;
  }, [bars, quotes, fairLine, kind, show, frame, kalshi]);

  const b = hover ?? bars.at(-1);
  // The hover card's extra rows: the bid and ask at that bar's close, and our fair value then.
  const quoteAt = hover ? quotes.find((q) => q.time === hover.time) : undefined;
  const fairAt = hover && show.fair ? fairLine.find((f) => f.time === hover.time)?.value : undefined;
  const when = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  const toggle = (k: keyof typeof show) => setShow((s) => ({ ...s, [k]: !s[k] }));
  const chip = (on: boolean) => (on ? "chip on" : "chip");

  return (
    <div className="candle">
      <div className="toolbar">
        <span className="chips" role="group" aria-label="Timeframe">
          {FRAMES.map((f) => (
            <button key={f.label} type="button" className={chip(f === frame)} onClick={() => setFrame(f)}>
              {f.label}
            </button>
          ))}
        </span>
        {kalshi && (
          <span className="chips" role="group" aria-label="Price">
            <button type="button" className={chip(source === "mid")} onClick={() => setSource("mid")}>
              Mid
            </button>
            <button type="button" className={chip(source === "trades")} onClick={() => setSource("trades")}>
              Trades
            </button>
          </span>
        )}
        <span className="chips" role="group" aria-label="Chart type">
          <button type="button" className={chip(kind === "candles")} onClick={() => setKind("candles")}>
            Candles
          </button>
          <button type="button" className={chip(kind === "line")} onClick={() => setKind("line")}>
            Line
          </button>
        </span>
        <span className="chips" role="group" aria-label="Overlays">
          {fair && fair.length > 0 && (
            <button type="button" className={chip(show.fair)} aria-pressed={show.fair} onClick={() => toggle("fair")}>
              Fair value
            </button>
          )}
          {kalshi && (
            <>
              <button type="button" className={chip(show.quotes)} aria-pressed={show.quotes} onClick={() => toggle("quotes")}>
                Bid–ask
              </button>
              <button type="button" className={chip(show.volume)} aria-pressed={show.volume} onClick={() => toggle("volume")}>
                Volume
              </button>
            </>
          )}
        </span>
        <span className="hint">Times UTC · drag to pan</span>
      </div>
      <div className="candle-meta">
        {b && (
          <div className="ohlc num" aria-live="off">
            <span>
              O <b>{cents(b.open)}</b>
            </span>
            <span>
              H <b>{cents(b.high)}</b>
            </span>
            <span>
              L <b>{cents(b.low)}</b>
            </span>
            <span>
              C <b className={b.close >= b.open ? "up" : "down"}>{cents(b.close)}</b>
            </span>
            {kalshi && (
              <span>
                Vol <b>{Math.round(b.volume).toLocaleString("en-US")}</b>
              </span>
            )}
          </div>
        )}
        <div className="candle-legend">
          {fair && fair.length > 0 && show.fair && (
            <span>
              <i className="swatch" style={{ background: "var(--fair)" }} />
              Manta fair value (Deribit options)
            </span>
          )}
          {kalshi && show.quotes && (
            <span>
              <i className="swatch dashed" style={{ borderColor: "var(--kalshi)" }} />
              Kalshi bid and ask
            </span>
          )}
          {!kalshi && <span>Polymarket&apos;s price (midpoint or last trade)</span>}
        </div>
      </div>
      <div className="candle-box">
        <div ref={box} className="candle-canvas" />
        {hover && at && (
          // Flips to the pointer's left past the middle, so it never runs off the chart's edge.
          <div
            className="candle-tip num"
            style={at.x > at.w / 2 ? { right: `calc(100% - ${at.x - 12}px)`, top: at.y } : { left: at.x + 16, top: at.y }}
            aria-hidden="true"
          >
            <span className="tip-time">{when(hover.time)} UTC</span>
            <span>Open</span>
            <b>{cents(hover.open)}</b>
            <span>High</span>
            <b>{cents(hover.high)}</b>
            <span>Low</span>
            <b>{cents(hover.low)}</b>
            <span>Close</span>
            <b className={hover.close >= hover.open ? "up" : "down"}>{cents(hover.close)}</b>
            <span>Change</span>
            <b className={hover.close >= hover.open ? "up" : "down"}>
              {hover.close >= hover.open ? "+" : "−"}
              {(Math.abs(hover.close - hover.open) * 100).toFixed(1)} pts
            </b>
            {kalshi && (
              <>
                <span>Volume</span>
                <b>{Math.round(hover.volume).toLocaleString("en-US")}</b>
              </>
            )}
            {quoteAt && show.quotes && (
              <>
                <span>Bid / ask</span>
                <b>
                  {cents(quoteAt.bid)} / {cents(quoteAt.ask)}
                </b>
              </>
            )}
            {fairAt !== undefined && (
              <>
                <span>Fair value</span>
                <b className="fair">{cents(fairAt)}</b>
              </>
            )}
          </div>
        )}
        {bars.length === 0 && <p className="muted candle-empty">No {source === "trades" ? "trades" : "prices"} in this window.</p>}
      </div>
    </div>
  );
}
