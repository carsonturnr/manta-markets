// The terminal's Markets panel rows, one per event with its featured contract: shared by the
// terminal and the home page's preview of it.
import type { MonitorRow } from "@/components/terminal/Monitor";
import type { Event } from "@/lib/events";
import { featured, mid, outcomeLabel, usableFair } from "@/lib/outcomes";

export function monitorRows(events: Event[]): MonitorRow[] {
  return events.map((x) => {
    const f = featured(x.outcomes, 1)[0];
    const fm = f ? mid(f) : null;
    const ff = f ? usableFair(f) : null;
    return {
      key: `${x.venue}/${x.event}`,
      venue: x.venue,
      question: x.question,
      category: x.category,
      close: x.close,
      volume: x.volume,
      usd: x.volumeUnit === "usd",
      outcomes: x.outcomes.length,
      focusId: f?.id ?? x.outcomes[0].id,
      label: f ? outcomeLabel(f) : "",
      mid: fm,
      spread: f && f.bid !== null && f.ask !== null ? f.ask - f.bid : null,
      gap: ff !== null && fm !== null ? ff - fm : null,
    };
  });
}
