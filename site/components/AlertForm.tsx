"use client";
// The "add an alert" form on a contract page. The work happens on the server
// (lib/accountActions.ts); this only shows its answer.
import { useActionState, useState } from "react";
import { addAlert, type AlertState } from "@/lib/accountActions";
import { KIND_LABEL, KINDS, type Kind } from "@/lib/alerts";

export default function AlertForm({
  venue,
  id,
  paired,
}: {
  venue: string;
  id: string;
  paired: boolean; // the contract has a match on the other venue
}) {
  const [state, action, pending] = useActionState(addAlert.bind(null, venue, id), null);
  // A new form after every answer (key), filled with the input after an error.
  return (
    <Fields key={state?.at ?? 0} state={state} action={action} pending={pending} paired={paired} />
  );
}

function Fields({
  state,
  action,
  pending,
  paired,
}: {
  state: AlertState;
  action: (form: FormData) => void;
  pending: boolean;
  paired: boolean;
}) {
  const kinds = KINDS.filter((k) => k !== "venues" || paired);
  const [kind, setKind] = useState<Kind>(
    kinds.find((k) => !state?.ok && k === state?.kind) ?? "above",
  );
  return (
    <form action={action} className="alert-form">
      <label htmlFor="alert-kind">Alert me when</label>
      <select
        id="alert-kind"
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input
        name="threshold"
        inputMode="decimal"
        required
        defaultValue={state?.ok ? "" : state?.threshold}
        aria-label={kind === "depth" ? "Contracts" : "Cents"}
        className="num"
      />
      <span>{kind === "depth" ? "contracts" : "¢"}</span>
      <button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add alert"}
      </button>
      {state && (
        <p className={state.ok ? "small" : "waitlist-error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
