"use client";
// The sign-up form: one email field, a consent box, and a field hidden from people (a bot that
// fills it in is ignored). The work happens on the server, in lib/waitlist.ts.
import Link from "next/link";
import { useActionState } from "react";
import { join } from "@/lib/waitlist";

export default function WaitlistForm() {
  const [state, action, pending] = useActionState(join, null);
  if (state?.ok) return <p className="waitlist-done">{state.message}</p>;
  return (
    <form action={action} className="waitlist">
      <label htmlFor="email">Email</label>
      <div className="waitlist-row">
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={state?.email}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      <div className="waitlist-trap" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="waitlist-consent">
        <input type="checkbox" name="consent" required defaultChecked={state !== null} /> Email me
        about Manta&apos;s launch. I agree to the <Link href="/privacy">privacy policy</Link>; I can
        ask for my address to be deleted at any time.
      </label>
      {state && !state.ok && (
        <p className="waitlist-error" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
