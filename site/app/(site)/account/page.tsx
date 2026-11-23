// The signed-in user's watchlist and alerts (step 11). Rows come through row-level security as
// this user only (lib/account.ts); prices from the screener's listing, refreshed every minute.
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import KeyForm from "@/components/KeyForm";
import { getAlerts, getFired, getKeys, getListed, getWatchlist, type Listed } from "@/lib/account";
import { deleteAlert, deleteKey, toggleWatch } from "@/lib/accountActions";
import { describe } from "@/lib/alerts";
import { utc } from "@/lib/format";
import { summary } from "@/lib/settlement";

export const metadata = { title: "Manta: account" };

export default function AccountPage() {
  return (
    <div className="wide">
      <h1>Your watchlist and alerts</h1>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Account />
      </Suspense>
    </div>
  );
}

const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : "Polymarket");

function Name({ venue, id, c }: { venue: string; id: string; c: Listed | undefined }) {
  return c ? (
    <Link href={`/contract/${venue}/${encodeURIComponent(id)}`}>{summary(c)}</Link>
  ) : (
    <span className="muted">
      <span className="num">{id}</span> (closed)
    </span>
  );
}

async function Account() {
  await connection();
  const { userId } = await auth();
  if (!userId) {
    return (
      <p>
        <SignInButton mode="modal">
          <button type="button" className="link-button">
            Sign in
          </button>
        </SignInButton>{" "}
        to see your watchlist and alerts.
      </p>
    );
  }
  const [watched, alerts, fired, keys] = await Promise.all([
    getWatchlist(userId),
    getAlerts(userId),
    getFired(userId),
    getKeys(userId),
  ]);
  const listed = await getListed([
    ...new Set([...watched, ...alerts].map((w) => `${w.venue}:${w.id}`)),
  ]);
  const byId = new Map(alerts.map((a) => [a.alertId, a]));

  return (
    <>
      <h2>Watchlist</h2>
      {watched.length === 0 ? (
        <p className="muted">
          Nothing yet. Open a contract from the <Link href="/screener">screener</Link> and press
          Watch.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Venue</th>
                <th className="num">Bid</th>
                <th className="num">Ask</th>
                <th className="num">Fair</th>
                <th>Closes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {watched.map((w) => {
                const c = listed.get(`${w.venue}:${w.id}`);
                return (
                  <tr key={`${w.venue}:${w.id}`}>
                    <td>
                      <Name venue={w.venue} id={w.id} c={c} />
                    </td>
                    <td>{venueName(w.venue)}</td>
                    <td className="num">{cents(c?.bid ?? null)}</td>
                    <td className="num">{cents(c?.ask ?? null)}</td>
                    <td className="num">{cents(c?.fair ?? null)}</td>
                    <td>{c ? utc(c.close) : "–"}</td>
                    <td>
                      <form action={toggleWatch.bind(null, w.venue, w.id)}>
                        <button type="submit" className="link-button">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>Alerts</h2>
      <p className="small">
        Checked every minute against the latest listing. An alert emails you when its condition
        starts to hold, at most once an hour, and again only after the condition has stopped
        holding. Alerts on a contract that has closed stop.
      </p>
      {alerts.length === 0 ? (
        <p className="muted">No alerts. Add one from any contract&apos;s page.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Condition</th>
                <th>Now</th>
                <th>Last email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.alertId}>
                  <td>
                    <Name venue={a.venue} id={a.id} c={listed.get(`${a.venue}:${a.id}`)} />
                  </td>
                  <td>{describe(a.kind, a.threshold)}</td>
                  <td>{a.ended ? "ended" : a.met ? <b>met</b> : "waiting"}</td>
                  <td>{a.fired ? utc(a.fired) : "–"}</td>
                  <td>
                    <form action={deleteAlert.bind(null, a.alertId)}>
                      <button type="submit" className="link-button">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fired.length > 0 && (
        <>
          <h2>Recently fired</h2>
          <ul className="small">
            {fired.map((f) => {
              const a = byId.get(f.alertId);
              return (
                <li key={`${f.alertId}:${f.ts}`}>
                  {utc(f.ts)}: {a ? describe(a.kind, a.threshold) : "a deleted alert"}
                  {f.value !== null && a?.kind !== "depth" && <> (at {cents(f.value)})</>}
                  {f.value !== null && a?.kind === "depth" && <> ({f.value} contracts)</>}
                  {f.emailed ? "" : ", email not sent"}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2>API keys</h2>
      <p className="small">
        Keys for Manta&apos;s analytics API: see <Link href="/docs/api">the API docs</Link>. Up to 3
        keys, sharing one limit of 60 units a minute. A key is shown once, when it is made; we keep
        only a fingerprint of it.
      </p>
      {keys.length > 0 && (
        <ul className="alert-list">
          {keys.map((k) => (
            <li key={k.keyId}>
              {k.name} <span className="num muted">{k.prefix}…</span>, made {utc(k.created)}, last
              used {k.lastUsed ? utc(k.lastUsed) : "never"}
              <form action={deleteKey.bind(null, k.keyId)}>
                <button type="submit" className="link-button">
                  Delete
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <KeyForm />
    </>
  );
}
