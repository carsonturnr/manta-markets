"use client";
// Tabs over panes the server already rendered: only the chosen one is shown. A client component
// only to remember the choice.
import { useState } from "react";

export default function Tabs({ tabs }: { tabs: { name: string; pane: React.ReactNode }[] }) {
  const [on, setOn] = useState(0);
  return (
    <div className="tabs">
      <div className="tab-row" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.name}
            type="button"
            role="tab"
            aria-selected={i === on}
            className={i === on ? "on" : ""}
            onClick={() => setOn(i)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.name} role="tabpanel" hidden={i !== on}>
          {t.pane}
        </div>
      ))}
    </div>
  );
}
