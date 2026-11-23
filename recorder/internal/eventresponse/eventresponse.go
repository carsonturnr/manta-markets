// Package eventresponse measures how a contract reacted to a scheduled economic release
// (payrolls, CPI, the Fed's decision): docs/plan-event-response.md.
//
// Words used here:
//   - t0: the official minute the number is published (13:30 UTC for payrolls and CPI).
//   - Bid / ask: the best price someone will buy at / sell at. Mid (midpoint): halfway between
//     them, the usual one-number reading of a contract's price. Spread: ask minus bid, what a
//     trader gives up crossing from one side to the other.
//   - Resting: an order waiting in the book. Depth near the mid: contracts resting within 2¢ of
//     it, what can be traded without moving the price far.
//
// Every function takes one contract's samples: its book each time it changed, in time order.
// A book stands until the next sample, so "the book at t" is the last sample at or before t.
// Prices are in cents (the venues quote 0–100¢ contracts) and times in unix milliseconds.
package eventresponse

import (
	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
)

const (
	second = int64(1000) // ms
	minute = 60 * second

	// Window is how long after t0 the move is measured: by 30 minutes the price has settled
	// at the market's new reading of the number.
	Window = 30 * minute
	// Hold is how long the mid must stay past the 90% point, so one stray quote that flicks
	// past and back doesn't count as the market having moved.
	Hold = 10 * second
	// NearMid is how close to the mid a resting order counts towards depth: 2¢.
	NearMid = 2.0
)

// Sample is one contract's book at time T (unix ms): levels best-first, in fixed-point units
// (internal/fixed), as internal/book returns them.
type Sample struct {
	T    int64
	Bids []book.Level
	Asks []book.Level
}

func cents(px int64) float64 { return float64(px) * 100 / float64(fixed.Scale) }

// Mid is the sample's midpoint in cents; false when a side is empty (no two-sided price).
func (s Sample) Mid() (float64, bool) {
	if len(s.Bids) == 0 || len(s.Asks) == 0 {
		return 0, false
	}
	return (cents(s.Bids[0].Px) + cents(s.Asks[0].Px)) / 2, true
}

// Spread is ask minus bid in cents; false when a side is empty.
func (s Sample) Spread() (float64, bool) {
	if len(s.Bids) == 0 || len(s.Asks) == 0 {
		return 0, false
	}
	return cents(s.Asks[0].Px) - cents(s.Bids[0].Px), true
}

// Depth is the number of contracts resting within NearMid of the mid, both sides together;
// false when there is no mid.
func (s Sample) Depth() (float64, bool) {
	mid, ok := s.Mid()
	if !ok {
		return 0, false
	}
	var n int64
	for _, l := range s.Bids {
		if cents(l.Px) >= mid-NearMid {
			n += l.Sz
		}
	}
	for _, l := range s.Asks {
		if cents(l.Px) <= mid+NearMid {
			n += l.Sz
		}
	}
	return float64(n) / float64(fixed.Scale), true
}

// at returns the book standing at t (the last sample at or before t); before returns the one
// standing just before t (the last sample strictly before t).
func at(series []Sample, t int64) (Sample, bool) {
	return last(series, func(s int64) bool { return s <= t })
}
func before(series []Sample, t int64) (Sample, bool) {
	return last(series, func(s int64) bool { return s < t })
}

func last(series []Sample, in func(int64) bool) (Sample, bool) {
	for i := len(series) - 1; i >= 0; i-- {
		if in(series[i].T) {
			return series[i], true
		}
	}
	return Sample{}, false
}

// ends returns the mid just before t0 and the mid at t0+Window; false if either is missing.
func ends(series []Sample, t0 int64) (start, end float64, ok bool) {
	s, ok1 := before(series, t0)
	e, ok2 := at(series, t0+Window)
	start, ok3 := s.Mid()
	end, ok4 := e.Mid()
	return start, end, ok1 && ok2 && ok3 && ok4
}

// Move is the mid at t0+30 min minus the mid just before t0, in cents (+6 for 40¢ → 46¢).
func Move(series []Sample, t0 int64) (float64, bool) {
	start, end, ok := ends(series, t0)
	return end - start, ok
}

// TimeTo90 is how long after t0 (ms) the mid first got 90% of the way from its value just
// before t0 to its value at t0+30 min, and stayed at or past that point for Hold. False when
// the move is zero (there is nothing to get 90% of) or a mid is missing. A moment with no mid
// (one side of the book empty) breaks a hold: we can't say the price was past the point.
func TimeTo90(series []Sample, t0 int64) (int64, bool) {
	start, end, ok := ends(series, t0)
	if !ok || end == start {
		return 0, false
	}
	target := start + 0.9*(end-start)
	past := func(s Sample) bool {
		m, ok := s.Mid()
		// At or beyond target in the move's direction; the 1e-9 lets a mid exactly on the point
		// count despite float rounding (cents are floats here).
		return ok && (m-target)*(end-start) >= -1e-9
	}

	// The candidate moments: t0 itself (the book standing then), then every later change.
	cur, _ := at(series, t0)
	cur.T = t0
	times := []Sample{cur}
	for _, s := range series {
		if s.T > t0 {
			times = append(times, s)
		}
	}
	for i, c := range times {
		if !past(c) {
			continue
		}
		held := true
		for _, s := range times[i+1:] {
			if s.T >= c.T+Hold {
				break
			}
			if !past(s) {
				held = false
				break
			}
		}
		if held {
			return c.T - t0, true
		}
	}
	return 0, false // the mid never held past the point (it kept falling back)
}

// Thinning is the depth near the mid 10 minutes before t0 and 30 seconds before t0 (contracts).
// Market makers pull their quotes before a number; the drop between the two shows by how much.
// False when either book is missing or one-sided.
func Thinning(series []Sample, t0 int64) (early, late float64, ok bool) {
	e, ok1 := at(series, t0-10*minute)
	l, ok2 := at(series, t0-30*second)
	early, ok3 := e.Depth()
	late, ok4 := l.Depth()
	return early, late, ok1 && ok2 && ok3 && ok4
}

// SpreadAt is the spread in cents of the book standing at t (for the page: at t0).
func SpreadAt(series []Sample, t int64) (float64, bool) {
	s, ok := at(series, t)
	if !ok {
		return 0, false
	}
	return s.Spread()
}
