"""Deribit's implied volatilities as a surface: volatility by strike and expiry.

Inputs are Deribit option summaries (`public/get_book_summary_by_currency`): each option's mark
implied volatility (`mark_iv`, in percent) and the forward price for its expiry
(`underlying_price`). We read the volatility at any strike and any time before or between
expiries:

- across strikes (the smile): linear in log-moneyness x = ln(K / F), where F is that expiry's
  forward price. Log-moneyness puts strikes on a scale that doesn't depend on BTC's level.
  Beyond the quoted strikes, the edge volatility is held flat;
- across time: a close before the first expiry uses that expiry's smile (volatility per unit of
  time assumed constant: docs/milestone-2-pricing.md, step 3). A close between two expiries
  interpolates total variance w = σ²·T linearly in time at the same log-moneyness, since
  variance, not volatility, is what adds up over time.
"""

import bisect
from dataclasses import dataclass, field
from datetime import UTC, datetime
from math import exp, log, sqrt

_MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
MONTHS = {m: i + 1 for i, m in enumerate(_MONTH_NAMES)}
DERIBIT_EXPIRY_HOUR_UTC = 8


def parse_instrument(name: str) -> tuple[float, float, str]:
    """'BTC-13NOV26-72000-C' → (expiry as unix seconds at 08:00 UTC, strike, 'C' or 'P')."""
    _, day, strike, kind = name.split("-")
    d, mon, yy = int(day[:-5]), MONTHS[day[-5:-2]], 2000 + int(day[-2:])
    expiry = datetime(yy, mon, d, DERIBIT_EXPIRY_HOUR_UTC, tzinfo=UTC).timestamp()
    return expiry, float(strike), kind


@dataclass
class Smile:
    """One expiry: volatility by log-moneyness, sorted."""

    expiry: float  # unix seconds
    forward: float
    xs: list[float] = field(default_factory=list)
    vols: list[float] = field(default_factory=list)

    def vol(self, strike: float) -> float:
        x = log(strike / self.forward)
        i = bisect.bisect_left(self.xs, x)
        if i == 0:
            return self.vols[0]
        if i == len(self.xs):
            return self.vols[-1]
        x0, x1 = self.xs[i - 1], self.xs[i]
        v0, v1 = self.vols[i - 1], self.vols[i]
        return v0 + (v1 - v0) * (x - x0) / (x1 - x0)


class Surface:
    def __init__(self, smiles: list[Smile]):
        self.smiles = sorted((s for s in smiles if len(s.xs) >= 2), key=lambda s: s.expiry)
        if not self.smiles:
            raise ValueError("no expiry with at least two quoted strikes")

    @classmethod
    def from_deribit(cls, summaries: list[dict], now: float) -> "Surface":
        """Build from book summaries. Per strike, the call and put mark volatilities (equal by
        put-call parity up to Deribit's rounding) are averaged."""
        by_expiry: dict[float, dict[float, list[float]]] = {}
        forwards: dict[float, float] = {}
        for s in summaries:
            iv, fwd = s.get("mark_iv"), s.get("underlying_price")
            if not iv or not fwd:
                continue
            expiry, strike, _ = parse_instrument(s["instrument_name"])
            if expiry <= now:
                continue
            by_expiry.setdefault(expiry, {}).setdefault(strike, []).append(iv / 100)
            forwards[expiry] = fwd
        smiles = []
        for expiry, strikes in by_expiry.items():
            fwd = forwards[expiry]
            pts = sorted((log(k / fwd), sum(v) / len(v)) for k, v in strikes.items())
            smiles.append(Smile(expiry, fwd, [p[0] for p in pts], [p[1] for p in pts]))
        return cls(smiles)

    def vol(self, strike: float, close: float, now: float) -> float:
        """Volatility for a contract on `strike` closing at unix time `close`."""
        later = [s for s in self.smiles if s.expiry >= close]
        earlier = [s for s in self.smiles if s.expiry < close]
        if not later:  # past the last expiry: hold its volatility
            return self.smiles[-1].vol(strike)
        s1 = later[0]
        if not earlier:  # before the first expiry: that expiry's smile
            return s1.vol(strike)
        s0 = earlier[-1]
        # Total variance at the same log-moneyness, linear in time between the two expiries.
        x = log(strike / s1.forward)
        k0 = s0.forward * exp(x)
        t0, t1, t = s0.expiry - now, s1.expiry - now, close - now
        w0, w1 = s0.vol(k0) ** 2 * t0, s1.vol(strike) ** 2 * t1
        w = w0 + (w1 - w0) * (t - t0) / (t1 - t0)
        return sqrt(max(w, 0.0) / t)

    def vol_slope(self, strike: float, close: float, now: float) -> float:
        """dσ/dK per dollar, by a central difference of ±0.5% in strike."""
        h = strike * 0.005
        return (self.vol(strike + h, close, now) - self.vol(strike - h, close, now)) / (2 * h)
