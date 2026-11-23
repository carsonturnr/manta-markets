"use client";
// "Make an API key" on /account. The server makes the key (lib/accountActions.ts) and sends it
// back once; this shows it until the page is left or that key is deleted (`ids`: the keys listed).
import { useActionState } from "react";
import { createKey } from "@/lib/accountActions";

export default function KeyForm({ ids }: { ids: number[] }) {
  const [made, action, pending] = useActionState(createKey, null);
  const state = made?.keyId !== undefined && !ids.includes(made.keyId) ? null : made;
  return (
    <form action={action} className="alert-form" key={made?.at ?? 0}>
      <label htmlFor="key-name">Name</label>
      <input id="key-name" name="name" maxLength={40} required placeholder="laptop" className="key-name" />
      <button type="submit" disabled={pending}>
        {pending ? "Making…" : "Make a key"}
      </button>
      {state && (
        <p className={state.ok ? "small" : "waitlist-error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
      {state?.key && (
        <p>
          <code className="api-key">{state.key}</code>
        </p>
      )}
    </form>
  );
}
