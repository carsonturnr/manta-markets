"use client";
// "What does $100 buy?": a dollar amount turned into contracts against the live order book, fees
// included (lib/outcomes.ts buyWithBudget, tested). Nothing is ordered: Manta only prices trades.
import { useState } from "react";
import { kalshiFee, polymarketFee } from "@/lib/cost";
import { buyWithBudget } from "@/lib/outcomes";
import type { Book } from "@/lib/venues";

type Props = {
  venue: "kalshi" | "polymarket";
  book: Book;
  rate: number | null; // taker fee rate; null when the market's fee type isn't one we model
  fair: number | null; // our fair value for "yes", when it's worth comparing
};

const money = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [25, 100, 500, 1000];

export default function BuyBox({ venue, book, rate, fair }: Props) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [text, setText] = useState("100");
  const budget = Math.max(0, Number.parseFloat(text) || 0);

  // Buying "no" at 1 − p is the other side of a "yes" bid at p, so its asks are the yes bids.
  const asks =
    side === "yes" ? book.asks : book.bids.map((l) => ({ price: Math.round((1 - l.price) * 1e4) / 1e4, size: l.size }));
  const fee = (n: number, p: number) =>
    rate === null ? 0 : venue === "kalshi" ? kalshiFee(rate, n, p) : polymarketFee(rate, n, p);
  const cost = buyWithBudget(budget, asks, fee);
  const best = (b: { price: number }[]) => (b[0] ? `${Math.round(b[0].price * 1000) / 10}¢` : "–");
  const worth = fair === null ? null : side === "yes" ? fair : 1 - fair;

  return (
    <div className="buy">
      <div className="seg wide" role="group" aria-label="Side">
        <button type="button" className={side === "yes" ? "on" : ""} onClick={() => setSide("yes")}>
          Yes {best(book.asks)}
        </button>
        <button type="button" className={side === "no" ? "on" : ""} onClick={() => setSide("no")}>
          No {best(book.bids.map((l) => ({ price: 1 - l.price })))}
        </button>
      </div>
      <label className="amount">
        <span>$</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Amount in dollars"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </label>
      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => setText(String(q))}>
            ${q.toLocaleString("en-US")}
          </button>
        ))}
      </div>
      {!cost ? (
        <p className="muted">{budget === 0 ? "Enter an amount." : "Not enough for one contract at the best price."}</p>
      ) : (
        <>
          <div className="line">
            <span>Contracts</span>
            <b className="num">{cost.filled.toLocaleString("en-US")}</b>
          </div>
          <div className="line">
            <span>Average price</span>
            <b className="num">{(Math.round(cost.average * 1000) / 10).toFixed(1)}¢</b>
          </div>
          <div className="line">
            <span>{venue === "kalshi" ? "Kalshi" : "Polymarket"} fee</span>
            <b className="num">{rate === null ? "unknown" : money(cost.fee)}</b>
          </div>
          <div className="line total">
            <span>Pays if {side === "yes" ? "Yes" : "No"}</span>
            <b className="num">{money(cost.filled)}</b>
          </div>
          <p className="note-sm">
            {cost.filled >= asks.reduce((n, l) => n + l.size, 0) && (
              <>The book runs out at {cost.filled.toLocaleString("en-US")} contracts. </>
            )}
            {worth !== null && (
              <>
                At Manta&apos;s estimate ({Math.round(worth * 100)}%), this is worth about{" "}
                {money(cost.filled * worth)}: {cost.filled * worth >= cost.total ? "more" : "less"} than
                the {money(cost.total)} it costs.{" "}
              </>
            )}
            Live order book, taker fees included. Manta doesn&apos;t place orders; not investment
            advice.
          </p>
        </>
      )}
    </div>
  );
}
