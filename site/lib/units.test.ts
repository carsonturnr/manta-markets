import assert from "node:assert/strict";
import { test } from "node:test";
import { expects } from "./units.ts";

test("expects: likely range and middle estimate, in the family's units", () => {
  assert.equal(
    expects("KXBTCD", { median: 59531, q25: 58953, q75: 60087 }, "Nov 25, 22:00 UTC"),
    "The market sees Bitcoin's price most likely landing between $58,953 and $60,087 at Nov 25, 22:00 UTC (a 50% chance); middle estimate $59,531.",
  );
  assert.equal(
    expects("KXFED", { median: 4.12, q25: null, q75: 4.39 }, "Dec 9"),
    "The market's middle estimate for the Fed funds rate (upper bound) at Dec 9 is 4.12%.",
  );
  assert.match(expects("KXCPI", { median: null, q25: 0.1, q75: 0.3 }, "x"), /Too few/);
});
