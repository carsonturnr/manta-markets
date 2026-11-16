import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getLiquidity, type HourCell } from "@/lib/liquidity";

export const metadata = { title: "Manta: liquidity" };

export default function LiquidityPage() {
  return (
    <div className="wide">
      <h1>Liquidity</h1>
      <p className="muted">
        How cheap each contract family is to trade, and when. Sampled every 15 minutes from the
        venues&apos; market lists. Only active contracts count: quoted on both sides, with a
        midpoint from 5¢ to 95¢ (strikes far from the price sit at 0/1¢ and would drown every
        median). Spread is the median ask minus bid; size is the median of the smaller of the best
        bid&apos;s and best ask&apos;s sizes, what a quick round trip can use. For the cost of a
        particular trade, use the calculator on any <Link href="/screener">contract page</Link>.
      </p>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Liquidity />
      </Suspense>
    </div>
  );
}

const NAME = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.name]));
const ORDER = FAMILIES.map((f) => `${f.venue}/${f.family}`);
const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : "Polymarket");
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
const qty = (n: number | null) =>
  n === null
    ? "–"
    : n >= 1e3
      ? `${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`
      : String(Math.round(n));

async function Liquidity() {
  await connection(); // request time only: the build never queries the database
  const { now, at, hours, since, samples } = await getLiquidity();
  if (now.length === 0) return <p className="muted">No samples yet.</p>;
  const days = since === null || at === null ? 0 : (at - since) / 86_400_000;
  const rank = (k: string) => (ORDER.indexOf(k) < 0 ? 999 : ORDER.indexOf(k));
  const rows = [...now].sort(
    (a, b) => rank(`${a.venue}/${a.family}`) - rank(`${b.venue}/${b.family}`),
  );
  return (
    <>
      <h2>Now</h2>
      <p className="small">Sample of {at === null ? "–" : utc(at)}.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th style={{ textAlign: "left" }}>Venue</th>
              <th>Active / open</th>
              <th>Median spread</th>
              <th>Median size at best</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.venue}/${r.family}`}>
                <td>
                  <Link href={`/screener?family=${r.family}`}>
                    {NAME.get(`${r.venue}/${r.family}`) ?? r.family}
                  </Link>
                </td>
                <td style={{ textAlign: "left" }}>{venueName(r.venue)}</td>
                <td className="num">
                  {r.active} / {r.contracts}
                </td>
                <td className="num">{cents(r.spread)}</td>
                <td className="num">{qty(r.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small">
        Kalshi prices move in 1¢ steps, so 1¢ is its narrowest spread; Polymarket&apos;s move in
        0.1¢ steps. Size is in contracts (Polymarket: shares, the same thing).
      </p>
      <Heatmap rows={rows.map((r) => `${r.venue}/${r.family}`)} hours={hours} />
      <p className="small">
        {samples} {samples === 1 ? "sample" : "samples"} since {since === null ? "–" : utc(since)} (
        {days.toFixed(1)} days).{" "}
        {days < 3 &&
          "Too little yet to say much about the hour of day: each cell rests on a few samples, all from the same day or two. It fills in as days accumulate."}
      </p>
    </>
  );
}

/** The heatmap's color for a spread: one hue, darker for wider, on a log scale from 0.1¢ to 20¢
 * (log, because spreads span two orders of magnitude). */
function shade(spread: number): string {
  const lo = Math.log(0.001);
  const hi = Math.log(0.2);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(spread, 0.001)) - lo) / (hi - lo)));
  return `color-mix(in oklab, var(--seq) ${Math.round(30 + t * 70)}%, var(--surface))`;
}

function Heatmap({ rows, hours }: { rows: string[]; hours: HourCell[] }) {
  const cell = new Map(hours.map((h) => [`${h.venue}/${h.family}/${h.hour}`, h]));
  const shown = rows.filter((k) => hours.some((h) => `${h.venue}/${h.family}` === k));
  return (
    <>
      <h2>Spread by hour of day</h2>
      <div className="legend">
        <span>Median spread, last 14 days, by hour (UTC). Narrow</span>
        {[0.001, 0.01, 0.05, 0.2].map((s) => (
          <span key={s}>
            <span className="key" style={{ background: shade(s) }} />
            {cents(s)}
          </span>
        ))}
        <span>wide · outlined: no sample in that hour yet</span>
      </div>
      <div className="table-wrap">
        <div className="heatmap">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="small num">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          {shown.map((k) => {
            const [venue, family] = k.split("/");
            return [
              <span key={k} className="small">
                {NAME.get(k) ?? family}{" "}
                <span className="muted">({venue === "kalshi" ? "K" : "P"})</span>
              </span>,
              ...Array.from({ length: 24 }, (_, h) => {
                const c = cell.get(`${k}/${h}`);
                return (
                  <span
                    key={`${k}/${h}`}
                    className="hcell"
                    style={c ? { background: shade(c.spread) } : undefined}
                    title={
                      c
                        ? `${NAME.get(k) ?? family}, ${String(h).padStart(2, "0")}:00 UTC: median spread ${cents(c.spread)} over ${c.n} samples`
                        : `${String(h).padStart(2, "0")}:00 UTC: no sample yet`
                    }
                  />
                );
              }),
            ];
          })}
        </div>
      </div>
    </>
  );
}
