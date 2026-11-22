"use client";
// Cost to trade (docs/product.md, step 6), recalculated as you type: the same walk of the live book
// and the same fee formulas as before (lib/cost.ts, tested), run in the browser instead of on a
// form submit. The side and size stay in the URL, so a result can still be shared.
import { useState } from "react";
import { kalshiFee, polymarketFee, walk } from "@/lib/cost";
import type { Book } from "@/lib/venues";

type Props = {
  venue: "kalshi" | "polymarket";
  book: Book;
  rate: number | null; // taker fee rate; null when the market's fee type isn't one we model
  makerRate: number | null;
  fair: number | null; // only a fair value worth comparing against (not single-venue consensus)
  side: "buy" | "sell";
  n: number;
};

const cents = (p: number) => `${Math.round(p * 1000) / 10}¢`;
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
const usd = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd4 = (x: number) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export default function CostCalc(p: Props) {
  const [side, setSide] = useState(p.side);
  const [text, setText] = useState(String(p.n));
  const n = Math.min(Math.max(Number.parseInt(text, 10) || 0, 0), 1_000_000);

  const update = (s: "buy" | "sell", t: string) => {
    setSide(s);
    setText(t);
    const url = new URL(window.location.href);
    url.searchParams.set("side", s);
    url.searchParams.set("n", t);
    window.history.replaceState(null, "", url); // shareable, without a navigation
  };

  const fee = (q: number, price: number) =>
    p.rate === null ? 0 : p.venue === "kalshi" ? kalshiFee(p.rate, q, price) : polymarketFee(p.rate, q, price);
  const cost = walk(side, n, side === "buy" ? p.book.asks : p.book.bids, fee);
  const buy = side === "buy";
  const atFair = cost && p.fair !== null ? cost.filled * p.fair : null;
  const vsFair = cost && atFair !== null ? (buy ? atFair - cost.total : cost.total - atFair) : null;
  const depth = (buy ? p.book.asks : p.book.bids).reduce((s, l) => s + l.size, 0);

  return (
    <div className="cost">
      <div className="cost-inputs">
        <span className="seg" role="group" aria-label="Side">
          <button type="button" className={buy ? "on" : ""} onClick={() => update("buy", text)}>
            Buy “yes”
          </button>
          <button type="button" className={buy ? "" : "on"} onClick={() => update("sell", text)}>
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
            onChange={(e) => update(side, e.target.value)}
          />
        </label>
        <input
          type="range"
          aria-label="Contracts"
          min={1}
          max={Math.max(10, Math.ceil(depth))}
          value={Math.min(n, Math.ceil(depth)) || 1}
          onChange={(e) => update(side, e.target.value)}
        />
      </div>
      {!cost ? (
        <p className="muted">
          {n === 0 ? "Enter a number of contracts." : `No ${buy ? "asks" : "bids"} to trade against.`}
        </p>
      ) : (
        <>
          <div className="kv-row num">
            <div>
              <span>{buy ? "You pay, all in" : "You receive, all in"}</span>
              <b>{usd(cost.total)}</b>
            </div>
            <div>
              <span>Per contract</span>
              <b>{cents(cost.perContract)}</b>
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
              <b>{p.rate === null ? "unknown" : usd4(cost.fee)}</b>
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
              <span className="status-bad">
                Only {qty(cost.filled)} of {qty(cost.wanted)} contracts are on offer in the best{" "}
                {cost.fills.length} levels.{" "}
              </span>
            )}
            {buy ? "Buying" : "Selling"} {qty(cost.filled)} contracts at once takes{" "}
            {cost.fills.length === 1 ? "one price level" : `${cost.fills.length} price levels`}, from{" "}
            {cents(cost.best)} to {cents(cost.fills.at(-1)!.price)}: {usd(cost.value)}{" "}
            {buy ? "paid" : "received"} before fees. Slippage is how much worse the average is than
            the best price: {usd(cost.slippage * cost.filled)} in all.{" "}
            {p.rate === null
              ? "This market's fee type isn't one we model, so fees are left out."
              : p.venue === "kalshi"
                ? `Kalshi's taker fee is ${p.rate} × contracts × price × (1 − price), rounded up to $0.0001 per fill${p.makerRate ? `; a resting order that fills later pays a maker fee of ${p.makerRate} instead` : "; resting orders pay no fee in this market"}.`
                : `Polymarket's taker fee is ${p.rate} × contracts × price × (1 − price); resting orders pay none.`}
            {vsFair !== null && (
              <>
                {" "}
                At our fair value of {cents(p.fair!)}, these contracts are worth {usd(atFair!)}: the
                trade is {usd(Math.abs(vsFair))} {vsFair >= 0 ? "better" : "worse"} than fair, all
                costs included. Not investment advice.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
