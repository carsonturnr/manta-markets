// Insights: when spreads are tightest. Folded in from the old /liquidity page (2026-11-26): the
// answer is the hour-of-day heat map; the spread-now bars and the day's profile sit under "More".
import Link from "next/link";
import { connection } from "next/server";
import { FAMILIES } from "@/lib/families";
import { utc } from "@/lib/format";
import { getLiquidity, type HourCell, type Now } from "@/lib/liquidity";
import { hourProfile, isThin } from "@/lib/liquidity-view";

const NAME = new Map(FAMILIES.map((f) => [`${f.venue}/${f.family}`, f.name]));
const ORDER = FAMILIES.map((f) => `${f.venue}/${f.family}`);
const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : "Polymarket");
const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
/** Spread in tenths of a cent, as shown: ties on the page rank by depth, not by invisible digits. */
const tenth = (r: Now) => Math.round(r.spread! * 1000);
const qty = (n: number | null) =>
  n === null
    ? "–"
    : n >= 1e3
      ? `${(n / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`
      : String(Math.round(n));

export default async function Spreads() {
  await connection(); // request time only: the build never queries the database
  const { now, at, hours, since, samples } = await getLiquidity();
  if (now.length === 0) return <p className="muted">No samples yet.</p>;
  const days = since === null || at === null ? 0 : (at - since) / 86_400_000;
  const rank = (k: string) => (ORDER.indexOf(k) < 0 ? 999 : ORDER.indexOf(k));
  const rows = [...now].sort(
    (a, b) => rank(`${a.venue}/${a.family}`) - rank(`${b.venue}/${b.family}`),
  );
  const label = (r: Now) =>
    `${NAME.get(`${r.venue}/${r.family}`) ?? r.family} (${venueName(r.venue)})`;
  const quoted = rows.filter((r) => r.spread !== null);
  const profile = hourProfile(hours);
  // The cheapest and dearest markets to cross right now, by spread.
  const bySpread = [...quoted].sort((a, b) => a.spread! - b.spread!);
  const cheap = bySpread[0];
  const dear = bySpread.at(-1);
  return (
    <>
      <p className="insight-says">
        <BestHours profile={profile} />
        {cheap && dear && cheap !== dear && (
          <>
            {" "}
            Which market matters more than the hour: crossing the spread costs{" "}
            <b className="num">{cents(cheap.spread)}</b> a contract on {label(cheap)} right now, but{" "}
            <b className="num down">{cents(dear.spread)}</b> on {label(dear)}.
          </>
        )}
      </p>
      <section className="panel stack">
        <Heatmap rows={rows.map((r) => `${r.venue}/${r.family}`)} hours={hours} />
        <p className="note">
          <b>Spread</b>: the gap between the best price to buy and the best price to sell; buying
          and selling straight back costs about this much per contract, before fees. From{" "}
          {samples.toLocaleString("en-US")} samples of every market, one every 15 minutes, since{" "}
          {since === null ? "–" : utc(since)} ({days.toFixed(1)} days).
          {days < 3 && " Too few days yet to trust: it fills in as days accumulate."}
        </p>
      </section>
      <details className="more">
        <summary>More: the day&apos;s profile over all markets, and every spread right now</summary>
        <section className="panel stack">
          <header className="ph">
            <h3>Spread through the day</h3>
            <span className="right m3">all markets, last 14 days, UTC</span>
          </header>
          <HourBars profile={profile} />
          <p className="note">
            Bars below the centre: hours when spreads are narrower than usual, so trading costs
            less. Each market&apos;s median spread in that hour is compared with its own typical
            hour, then averaged over markets.
          </p>
        </section>
        <section className="panel stack">
          <header className="ph">
            <h3>Spread right now, by market</h3>
            <span className="right m3">Sample of {at === null ? "–" : utc(at)}</span>
          </header>
          <SpreadBars rows={quoted} label={label} />
          <p className="note">
            Narrowest first; dimmed rows are thin (a spread of 5¢ or more, or under 20 contracts at
            the best price). <b>Depth</b>: how many contracts wait at the best prices. Bars stop at{" "}
            {cents(BAR_MAX)}; wider spreads are marked with an arrow. Kalshi prices move in 1¢
            steps, so 1¢ is its narrowest spread; Polymarket&apos;s move in 0.1¢ steps.
          </p>
        </section>
      </details>
    </>
  );
}

const BAR_MAX = 0.1; // bars are drawn to 10¢: most spreads are 1–5¢, and one 40¢ outlier would flatten them
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** An hour UTC as New York's clock reads it today ("1 pm"), for US traders. */
const ny = (h: number) => {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  return d.toLocaleString("en-US", { hour: "numeric", timeZone: "America/New_York" }).toLowerCase();
};

/** The day's best and worst hours, in words. Under 5% either way, the hour doesn't matter. */
function BestHours({ profile }: { profile: (number | null)[] }) {
  const known = profile.flatMap((v, h) => (v === null ? [] : [{ h, v }]));
  if (known.length < 12) return <>Not enough hours sampled yet.</>;
  const best = known.reduce((a, b) => (b.v < a.v ? b : a));
  const worst = known.reduce((a, b) => (b.v > a.v ? b : a));
  if (1 - best.v < 0.05 && worst.v - 1 < 0.05)
    return <>Spreads barely change with the time of day: every hour is within 5% of typical.</>;
  return (
    <>
      Spreads are narrowest around <b className="num">{hh(best.h)} UTC</b> ({ny(best.h)} in New
      York), about {Math.round((1 - best.v) * 100)}% below a typical hour, and widest around{" "}
      <b className="num">{hh(worst.h)} UTC</b> ({ny(worst.h)}), {Math.round((worst.v - 1) * 100)}%
      above.
    </>
  );
}

function SpreadBars({ rows, label }: { rows: Now[]; label: (r: Now) => string }) {
  const sorted = [...rows].sort((a, b) => tenth(a) - tenth(b) || (b.size ?? 0) - (a.size ?? 0));
  return (
    <div className="spread-bars pad">
      {sorted.map((r) => (
        <div key={`${r.venue}/${r.family}`} className={isThin(r) ? "row thin" : "row"}>
          <span className="name">
            <Link href={`/screener?family=${r.family}`}>{label(r)}</Link>
          </span>
          <span className="track">
            <span
              className="bar"
              style={{ width: `${(Math.min(r.spread!, BAR_MAX) / BAR_MAX) * 100}%` }}
            />
          </span>
          <span className="num val">
            {cents(r.spread)}
            {r.spread! > BAR_MAX && " →"}
          </span>
          <span className="num m3 depth">{qty(r.size)} deep</span>
        </div>
      ))}
    </div>
  );
}

/** 24 bars, one per hour, from a centre line at a typical hour's spread: down where spreads are
 * narrower than usual (cheaper), up where wider. */
function HourBars({ profile }: { profile: (number | null)[] }) {
  const known = profile.filter((v): v is number => v !== null);
  const reach = Math.max(0.1, ...known.map((v) => Math.abs(v - 1))) * 1.1;
  const best = known.length ? Math.min(...known) : null;
  return (
    <div className="pad">
      <div className="hour-bars">
        <span className="edge top m3 small">wider</span>
        <span className="edge bottom m3 small">narrower</span>
        {profile.map((v, h) => {
          const share = v === null ? 0 : (Math.abs(v - 1) / reach) * 50;
          return (
            <span
              key={h}
              className={v !== null && v === best ? "col best" : "col"}
              title={
                v === null
                  ? `${hh(h)} UTC: no sample yet`
                  : `${hh(h)} UTC: spreads ${Math.abs(Math.round((v - 1) * 100))}% ${v < 1 ? "narrower" : "wider"} than a typical hour`
              }
            >
              <span
                className={v !== null && v < 1 ? "bar down" : "bar"}
                style={
                  v !== null && v < 1
                    ? { top: "50%", height: `${share}%` }
                    : { bottom: "50%", height: `${share}%` }
                }
              />
            </span>
          );
        })}
      </div>
      <div className="hour-axis">
        {profile.map((_, h) => (
          <span key={h} className="small num">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The heatmap's color for a spread: the market's grey, brighter for wider (costlier), on a log
 * scale from 0.1¢ to 20¢ (log, because spreads span two orders of magnitude). Grey, not mint:
 * mint is Manta's own numbers, and a spread is the market's. */
function shade(spread: number): string {
  const lo = Math.log(0.001);
  const hi = Math.log(0.2);
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(spread, 0.001)) - lo) / (hi - lo)));
  return `color-mix(in oklab, var(--ink) ${Math.round(15 + t * 85)}%, var(--surface))`;
}

function Heatmap({ rows, hours }: { rows: string[]; hours: HourCell[] }) {
  const cell = new Map(hours.map((h) => [`${h.venue}/${h.family}/${h.hour}`, h]));
  const shown = rows.filter((k) => hours.some((h) => `${h.venue}/${h.family}` === k));
  return (
    <>
      <header className="ph">
        <h3>Spread by hour of day</h3>
        <span className="right m3">median, last 14 days, UTC</span>
      </header>
      <div className="legend pad-x">
        <span>Median spread, last 14 days, by hour (UTC). Narrow</span>
        {[0.001, 0.01, 0.05, 0.2].map((s) => (
          <span key={s}>
            <span className="key" style={{ background: shade(s) }} />
            {cents(s)}
          </span>
        ))}
        <span>wide · outlined: no sample in that hour yet</span>
      </div>
      <div className="table-wrap pad">
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
