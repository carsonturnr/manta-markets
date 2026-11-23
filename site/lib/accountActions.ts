"use server";
// The account forms' server actions (step 11). Each one can be called by anyone on the internet,
// so each checks Clerk's session first and validates every input; the database's row-level
// security is the second line (lib/account.ts).
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { hashKey, keyPrefix, MAX_KEYS, newKey } from "./api";
import { asUser, isPaired, MAX_ALERTS, MAX_WATCHED } from "./account";
import { KINDS, type Kind, parseThreshold } from "./alerts";
import { getMarket } from "./screener";

const VENUES = ["kalshi", "polymarket"];

async function signedIn(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  return userId;
}

/** Adds the contract to the watchlist, or removes it if it's there. */
export async function toggleWatch(venue: string, id: string): Promise<void> {
  const userId = await signedIn();
  if (!VENUES.includes(venue) || id.length > 200) return;
  await asUser(userId, async (tx) => {
    const removed = await tx`delete from manta.watchlist where venue = ${venue} and id = ${id}`;
    if (removed.count > 0) return;
    const [{ n }] = await tx`select count(*)::int as n from manta.watchlist`;
    if (n >= MAX_WATCHED || !(await getMarket(venue, id))) return;
    await tx`insert into manta.watchlist (user_id, venue, id) values (${userId}, ${venue}, ${id})`;
  });
  revalidatePath("/account");
}

// After an error the form shows the visitor's own input again (React clears a form on submit);
// `at` makes every answer new, so the form starts afresh after each one.
export type AlertState = {
  ok: boolean;
  message: string;
  at: number;
  kind?: string;
  threshold?: string;
} | null;

export async function addAlert(
  venue: string,
  id: string,
  _prev: AlertState,
  form: FormData,
): Promise<AlertState> {
  const userId = await signedIn();
  const kind = String(form.get("kind") ?? "") as Kind;
  const raw = String(form.get("threshold") ?? "").slice(0, 20);
  const failed = (message: string) => ({
    ok: false,
    message,
    at: Date.now(),
    kind,
    threshold: raw,
  });
  if (!KINDS.includes(kind) || !VENUES.includes(venue)) return failed("Pick a condition.");
  const threshold = parseThreshold(kind, raw);
  if (typeof threshold === "string") return failed(threshold);
  const market = await getMarket(venue, id);
  if (!market) return failed("This contract is no longer listed.");
  if (kind === "venues" && !(await isPaired(venue, id)))
    return failed("This contract has no match on the other venue.");
  const added = await asUser(userId, async (tx) => {
    const [{ n }] = await tx`select count(*)::int as n from manta.alerts where ended is null`;
    if (n >= MAX_ALERTS) return false;
    await tx`
      insert into manta.alerts (user_id, venue, id, kind, threshold)
      values (${userId}, ${venue}, ${id}, ${kind}, ${threshold})`;
    return true;
  });
  if (!added) return failed(`You have ${MAX_ALERTS} alerts; delete one to add another.`);
  revalidatePath("/account");
  return { ok: true, message: "Alert added. It is checked every minute.", at: Date.now() };
}

export async function deleteAlert(alertId: number): Promise<void> {
  const userId = await signedIn();
  if (!Number.isSafeInteger(alertId)) return;
  await asUser(userId, (tx) => tx`delete from manta.alerts where alert_id = ${alertId}`);
  revalidatePath("/account");
}

// The new key comes back once, in this answer, and is never stored or shown again.
export type KeyState = { ok: boolean; message: string; at: number; key?: string } | null;

export async function createKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const userId = await signedIn();
  const name = String(form.get("name") ?? "").trim();
  const answer = (ok: boolean, message: string, key?: string) => ({ ok, message, at: Date.now(), key });
  if (name.length < 1 || name.length > 40) return answer(false, "Name the key (up to 40 characters).");
  const key = newKey();
  const made = await asUser(userId, async (tx) => {
    const [{ n }] = await tx`select count(*)::int as n from manta.api_keys`;
    if (n >= MAX_KEYS) return false;
    await tx`
      insert into manta.api_keys (user_id, name, hash, prefix)
      values (${userId}, ${name}, ${hashKey(key)}, ${keyPrefix(key)})`;
    return true;
  });
  if (!made) return answer(false, `You have ${MAX_KEYS} keys; delete one to make another.`);
  revalidatePath("/account");
  return answer(true, "Copy this key now: it won't be shown again.", key);
}

export async function deleteKey(keyId: number): Promise<void> {
  const userId = await signedIn();
  if (!Number.isSafeInteger(keyId)) return;
  await asUser(userId, (tx) => tx`delete from manta.api_keys where key_id = ${keyId}`);
  revalidatePath("/account");
}
