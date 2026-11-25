"use client";
// Cost to trade: buy or sell N contracts against the live order book, recalculated as you type.
// It walks the book level by level (slippage) and adds the venue's taker fee (lib/cost.ts, tested).
// The one calculator on the site: the Market page and the terminal both show it (LivePanels.tsx).
// Nothing is ordered: Manta only prices trades.
import { useState } from "react";
import { kalshiFee, polymarketFee, walk } from "@/lib/cost";
import type { Book } from "@/lib/venues";

type Props = {
  venue: "kalshi" | "polymarket";
  book: Book;
  rate: number | null; // taker fee rate; null when the market's fee type isn't one we model
  fair: number | null; // only a fair value worth comparing against (not single-venue consensus)
};

const cents = (p: number) => `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
const usd = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const QUICK = [10, 100, 1000];

export default function CostCalc(p: Props) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("100");
  const n = Math.min(Math.max(Number.parseInt(text, 10) || 0, 0), 1_000_000);

  const fee = (q: number, price: number) =>
    p.rate === null ? 0 : p.venue === "kalshi" ? kalshiFee(p.rate, q, price) : polymarketFee(p.rate, q, price);
  const buy = side === "buy";
  const cost = walk(side, n, buy ? p.book.asks : p.book.bids, fee);
  const atFair = cost && p.fair !== null ? cost.filled * p.fair : null;
  const vsFair = cost && atFair !== null ? (buy ? atFair - cost.total : cost.total - atFair) : null;

  return (
    <div className="cost">
      <div className="cost-inputs">
        <span className="seg" role="group" aria-label="Side">
          <button type="button" className={buy ? "on" : ""} onClick={() => setSide("buy")}>
            Buy “yes”
          </button>
          <button type="button" className={buy ? "" : "on"} onClick={() => setSide("sell")}>
            Sell “yes”
          </button>
        </span>
        <label className="field">
          <span>Contracts</span>
          <input
            type="number"
            min={1}
            max={1000000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <span className="quick">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => setText(String(q))}>
              {q.toLocaleString("en-US")}
            </button>
          ))}
        </span>
      </div>
      {!cost ? (
        <p className="muted">
          {n === 0 ? "Enter a number of contracts." : `No ${buy ? "asks" : "bids"} to trade against.`}
        </p>
      ) : (
        <>
          <div className="kv-row num">
            <div>
              <span>{buy ? "You pay, all in" : "You get, all in"}</span>
              <b>{usd(cost.total)}</b>
            </div>
            <div>
              <span>Average price</span>
              <b>{cents(cost.average)}</b>
            </div>
            <div>
              <span>Slippage</span>
              <b>{cents(cost.slippage)}</b>
            </div>
            <div>
              <span>Fee</span>
              <b>{p.rate === null ? "unknown" : usd(cost.fee)}</b>
            </div>
            {vsFair !== null && (
              <div>
                <span>Versus fair value</span>
                <b className={vsFair >= 0 ? "up" : "down"}>
                  {vsFair >= 0 ? "+" : "−"}
                  {usd(Math.abs(vsFair))}
                </b>
              </div>
            )}
          </div>
          <p className="note">
            {cost.filled < cost.wanted && (
              <span className="status-bad">Only {qty(cost.filled)} contracts are on offer. </span>
            )}
            Slippage: how much worse the average price is than the best one, because a big order
            eats into several price levels. Each contract pays $1 if &ldquo;yes&rdquo; happens.
            {p.rate === null && " This market's fee isn't one Manta models, so fees are left out."}{" "}
            Manta places no orders.
          </p>
        </>
      )}
    </div>
  );
}
