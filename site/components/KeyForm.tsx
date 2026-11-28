"use client";
// "Make an API key" on /account. The server makes the key (lib/accountActions.ts) and sends it
// back once; this shows it until the page is left or that key is deleted (`ids`: the keys listed).
import { useActionState } from "react";
import { createKey } from "@/lib/accountActions";

export default function KeyForm({ ids }: { ids: number[] }) {
  const [made, action, pending] = useActionState(createKey, null);
  const state = made?.keyId !== undefined && !ids.includes(made.keyId) ? null : made;
  return (
    <form action={action} className="acct-key" key={made?.at ?? 0}>
      <input name="name" maxLength={40} required placeholder="Name, e.g. laptop" aria-label="Key name" />
      <button type="submit" disabled={pending}>
        {pending ? "Making…" : "Make a key"}
      </button>
      {state && !state.key && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}
      {state?.key && (
        <div className="acct-new" role="status">
          {state.message}
          <code>{state.key}</code>
        </div>
      )}
    </form>
  );
}
