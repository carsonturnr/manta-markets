"use server";
// The waitlist sign-up (step 10). Runs on the server only, through its own database login,
// manta_signup, which can insert an email into manta.waitlist and do nothing else: no reading,
// no other table (db/schema.sql). Email addresses are personal data: never logged, and the answer
// is the same whether the address is new or already on the list, so the form can't be used to
// find out who signed up. After an error the visitor's own input goes back to their browser, so
// the form (which React clears on submit) can show it again.
import postgres from "postgres";

const url = process.env.SIGNUP_DATABASE_URL;
// The same session-pooler rule as lib/db.ts. One connection: sign-ups are rare.
const signup = url && !url.includes(":6543/") ? postgres(url, { max: 1, idle_timeout: 20 }) : null;

export type JoinState = { ok: boolean; message: string; email?: string } | null;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // the same check as the table's

export async function join(_prev: JoinState, form: FormData): Promise<JoinState> {
  // A field people can't see: a bot that fills in every field is thanked and ignored.
  if (String(form.get("website") ?? "") !== "")
    return { ok: true, message: "Thanks, you're on the list." };
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const failed = (message: string) => ({ ok: false, message, email });
  if (email.length > 254 || !EMAIL.test(email))
    return failed("That doesn't look like an email address.");
  if (form.get("consent") !== "on")
    return failed("Please tick the box to agree to the privacy policy.");
  if (!signup) return failed("Sign-up isn't open yet. Please try again later.");
  try {
    await signup`insert into manta.waitlist (email) values (${email}) on conflict do nothing`;
  } catch (e) {
    // The error's class only: its message could quote the address.
    console.error("waitlist insert failed:", e instanceof Error ? e.name : "unknown error");
    return failed("Something went wrong on our side. Please try again later.");
  }
  return { ok: true, message: "Thanks, you're on the list." };
}
