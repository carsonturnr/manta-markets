// The signed-in user's watchlist, alerts and API keys (steps 11 and 13), as terminal panels in two
// columns like the Market page. Rows come through row-level security as this user only
// (lib/account.ts); prices from the screener's listing, refreshed every minute.
import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import KeyForm from "@/components/KeyForm";
import { getAlerts, getFired, getKeys, getListed, getWatchlist, type Listed } from "@/lib/account";
import { deleteAlert, deleteKey, toggleWatch } from "@/lib/accountActions";
import { describe } from "@/lib/alerts";
import { MAX_KEYS } from "@/lib/api";
import { utc } from "@/lib/format";
import { summary } from "@/lib/settlement";

export const metadata = { title: "Manta: account" };

export default function AccountPage() {
  return (
    <div className="wide acct">
      <Suspense
        fallback={
          <>
            <h1>Account</h1>
            <p className="muted">Loading…</p>
          </>
        }
      >
        <Account />
      </Suspense>
    </div>
  );
}

const cents = (p: number | null) => (p === null ? "–" : `${Math.round(p * 1000) / 10}¢`);
const venueName = (v: string) => (v === "kalshi" ? "Kalshi" : "Polymarket");
const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// A contract missing from the listing has closed: its id stands in for the name.
function Name({ venue, id, c }: { venue: string; id: string; c: Listed | undefined }) {
  return c ? (
    <Link href={`/contract/${venue}/${encodeURIComponent(id)}`}>{summary(c)}</Link>
  ) : (
    <span className="mono">{id}</span>
  );
}

/** One terminal panel (.t-panel): code and title, then a count and a "?" tip at the right. */
function Panel({
  code,
  title,
  count,
  tip,
  children,
}: {
  code: string;
  title: string;
  count?: React.ReactNode;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="t-panel">
      <header>
        <span className="t-code">{code}</span>
        <h2>{title}</h2>
        {count !== undefined && <span className="acct-count">{count}</span>}
        {tip && (
          <button type="button" className="t-help" aria-label={`About ${title}: ${tip}`} data-tip={tip}>
            ?
          </button>
        )}
      </header>
      <div className="t-body">{children}</div>
    </section>
  );
}

function Delete({ action, label, word = "Delete" }: { action: () => Promise<void>; label: string; word?: string }) {
  return (
    <form action={action}>
      <button type="submit" className="acct-del" aria-label={label}>
        {word}
      </button>
    </form>
  );
}

async function Account() {
  await connection();
  const { userId } = await auth();
  if (!userId) {
    return (
      <div className="signed-out">
        <h1>Sign in to Manta</h1>
        {/* Clerk's own form, in place: hash routing keeps it on this URL. */}
        <SignIn
          routing="hash"
          fallbackRedirectUrl="/account"
          appearance={{
            variables: {
              colorPrimary: "#00ff77",
              colorPrimaryForeground: "#000000",
              colorBackground: "#0b0b0c",
              colorForeground: "#f2f2f2",
              colorMutedForeground: "#9a9a9a",
              colorInput: "#000000",
              colorInputForeground: "#f2f2f2",
              colorNeutral: "#f2f2f2",
              borderRadius: "3px",
              fontFamily: "var(--font-sans), system-ui, sans-serif",
            },
            // The page's own h1 says "Sign in"; Clerk's title and welcome line would repeat it.
            elements: { header: { display: "none" } },
          }}
        />
      </div>
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
      <h1>Account</h1>
      <div className="acct-grid">
        <div className="acct-col">
          <Panel code="WL" title="Watchlist" count={watched.length || undefined}>
            {watched.length === 0 ? (
              <div className="acct-empty">
                <p>No markets watched.</p>
                <Link href="/terminal" className="btn btn-sm btn-ghost">
                  Watch a market from the terminal
                </Link>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th className="wide-only">Fair</th>
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
                          {!c && <span className="acct-badge off">closed</span>}
                          <span className="acct-sub">
                            {venueName(w.venue)}
                            {c && ` · closes ${utc(c.close)}`}
                          </span>
                        </td>
                        <td>{cents(c?.bid ?? null)}</td>
                        <td>{cents(c?.ask ?? null)}</td>
                        <td className="wide-only">{cents(c?.fair ?? null)}</td>
                        <td>
                          <Delete
                            action={toggleWatch.bind(null, w.venue, w.id)}
                            label={`Remove ${c ? summary(c) : w.id} from the watchlist`}
                            word="Remove"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel
            code="AL"
            title="Alerts"
            count={alerts.length || undefined}
            tip="Checked every minute. An alert emails you when its condition starts to hold, at most once an hour, and again only after the condition has stopped holding. Alerts on a closed contract end."
          >
            {alerts.length === 0 ? (
              <div className="acct-empty">
                <p>No alerts.</p>
                <Link href="/terminal" className="btn btn-sm btn-ghost">
                  Set an alert from the terminal
                </Link>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Status</th>
                    <th className="wide-only">Last fired</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.alertId}>
                      <td>
                        <Name venue={a.venue} id={a.id} c={listed.get(`${a.venue}:${a.id}`)} />
                        {!listed.has(`${a.venue}:${a.id}`) && !a.ended && (
                          <span className="acct-badge off">closed</span>
                        )}
                        <span className="acct-sub">{describe(a.kind, a.threshold)}</span>
                      </td>
                      <td>
                        {a.ended ? (
                          <span className="acct-badge off">ended</span>
                        ) : a.met ? (
                          <span className="acct-badge met">met</span>
                        ) : (
                          <span className="acct-badge">waiting</span>
                        )}
                      </td>
                      <td className="wide-only">{a.fired ? utc(a.fired) : "–"}</td>
                      <td>
                        <Delete
                          action={deleteAlert.bind(null, a.alertId)}
                          label={`Delete the alert: ${describe(a.kind, a.threshold)}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="acct-col">
          {fired.length > 0 && (
            <Panel code="LOG" title="Recently fired">
              <table>
                <thead>
                  <tr>
                    <th>Alert</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fired.map((f) => {
                    const a = byId.get(f.alertId);
                    return (
                      <tr key={`${f.alertId}:${f.ts}`}>
                        <td>
                          {a ? describe(a.kind, a.threshold) : "A deleted alert"}
                          {!f.emailed && <span className="acct-badge warn">email failed</span>}
                          <span className="acct-sub">{utc(f.ts)}</span>
                        </td>
                        {/* The value that met it: contracts for a depth alert, a price otherwise. */}
                        <td>
                          {f.value === null
                            ? "–"
                            : a?.kind === "depth"
                              ? f.value.toLocaleString("en-US")
                              : cents(f.value)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel
            code="API"
            title="API keys"
            count={
              <>
                <Link href="/docs/api">Docs</Link>{" "}
                {keys.length} of {MAX_KEYS}
              </>
            }
            tip={`Keys for Manta's analytics API. Up to ${MAX_KEYS} keys, sharing one limit of 60 units a minute. A key is shown once, when it is made; we keep only a fingerprint of it.`}
          >
            {keys.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.keyId}>
                      <td>
                        {k.name}
                        <span className="acct-sub" title={utc(k.created)}>
                          <span className="mono">{k.prefix}…</span> · made {day(k.created)}
                        </span>
                      </td>
                      <td>{k.lastUsed ? utc(k.lastUsed) : "never"}</td>
                      <td>
                        <Delete action={deleteKey.bind(null, k.keyId)} label={`Delete the key ${k.name}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <KeyForm ids={keys.map((k) => k.keyId)} />
          </Panel>
        </div>
      </div>
    </>
  );
}
