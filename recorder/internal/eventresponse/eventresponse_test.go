package eventresponse

import (
	"math"
	"testing"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
)

const t0 = int64(1_796_391_000_000) // 2026-12-04 13:30:00 UTC, payrolls (unix ms)

// lv is one level: price in cents, size in contracts.
func lv(px, sz float64) book.Level {
	return book.Level{Px: int64(px * float64(fixed.Scale) / 100), Sz: int64(sz * float64(fixed.Scale))}
}

// quote is a one-level book: bid and ask in cents, 100 contracts each side.
func quote(t int64, bid, ask float64) Sample {
	return Sample{T: t, Bids: []book.Level{lv(bid, 100)}, Asks: []book.Level{lv(ask, 100)}}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// A clean move: mid 40¢ (39/41) before, 46¢ (45/47) at +30 min. 90% of +6¢ is +5.4¢, so the
// point is 45.4¢. At +1.0 s the mid is 43¢ (not there), at +2.4 s it is 45.5¢ (past), and it
// stays past: time to 90% is 2.4 s.
func TestCleanMove(t *testing.T) {
	s := []Sample{
		quote(t0-20*minute, 39, 41),
		quote(t0+1*second, 42, 44),
		quote(t0+2400, 45, 46),
		quote(t0+5*minute, 45, 47),
	}
	if m, ok := Move(s, t0); !ok || !near(m, 6) {
		t.Fatalf("move = %v %v, want 6", m, ok)
	}
	if d, ok := TimeTo90(s, t0); !ok || d != 2400 {
		t.Fatalf("time to 90%% = %v %v, want 2400 ms", d, ok)
	}
	if sp, ok := SpreadAt(s, t0); !ok || !near(sp, 2) {
		t.Fatalf("spread at t0 = %v %v, want 2", sp, ok)
	}
}

// A stray quote: at +0.5 s the mid jumps to 46¢ but falls back to 41¢ 3 s later (inside the
// 10 s hold), so it doesn't count. The real crossing is at +8 s. A fall works the same way:
// here the move is 40¢ → 34¢ (−6¢), point 34.6¢.
func TestStrayQuoteDoesNotCount(t *testing.T) {
	up := []Sample{
		quote(t0-1*minute, 39, 41),
		quote(t0+500, 45, 47),
		quote(t0+3500, 40, 42),
		quote(t0+8*second, 45, 47),
	}
	if d, ok := TimeTo90(up, t0); !ok || d != 8000 {
		t.Fatalf("up: time to 90%% = %v %v, want 8000 ms", d, ok)
	}
	down := []Sample{
		quote(t0-1*minute, 39, 41),
		quote(t0+500, 33, 35),
		quote(t0+3500, 39, 41),
		quote(t0+8*second, 33, 35),
	}
	if m, _ := Move(down, t0); !near(m, -6) {
		t.Fatalf("down: move = %v, want -6", m)
	}
	if d, ok := TimeTo90(down, t0); !ok || d != 8000 {
		t.Fatalf("down: time to 90%% = %v %v, want 8000 ms", d, ok)
	}
}

// A one-sided book (asks pulled) during the hold breaks it: no mid, so not past the point.
func TestEmptySideBreaksTheHold(t *testing.T) {
	s := []Sample{
		quote(t0-1*minute, 39, 41),
		quote(t0+1*second, 45, 47),
		{T: t0 + 2*second, Bids: []book.Level{lv(45, 10)}},
		quote(t0+4*second, 45, 47),
	}
	if d, ok := TimeTo90(s, t0); !ok || d != 4000 {
		t.Fatalf("time to 90%% = %v %v, want 4000 ms", d, ok)
	}
}

// Already past at t0 (a sample at exactly t0 is the book standing then): time to 90% is 0.
// The mid just before t0 is still the 12:29:59 one, so the move is measured from it.
func TestMovedAtT0(t *testing.T) {
	s := []Sample{quote(t0-1*second, 39, 41), quote(t0, 45, 47)}
	if m, _ := Move(s, t0); !near(m, 6) {
		t.Fatalf("move = %v, want 6", m)
	}
	if d, ok := TimeTo90(s, t0); !ok || d != 0 {
		t.Fatalf("time to 90%% = %v %v, want 0", d, ok)
	}
}

// A move of zero: the move is 0 (a real answer), but time to 90% has nothing to measure.
func TestZeroMove(t *testing.T) {
	s := []Sample{quote(t0-1*minute, 39, 41), quote(t0+1*second, 45, 47), quote(t0+10*minute, 39, 41)}
	if m, ok := Move(s, t0); !ok || m != 0 {
		t.Fatalf("move = %v %v, want 0 true", m, ok)
	}
	if _, ok := TimeTo90(s, t0); ok {
		t.Fatal("time to 90% of a zero move should be undefined")
	}
}

// A contract with no quotes, or only quotes after t0, or one side only: nothing is measured.
func TestNoQuotes(t *testing.T) {
	oneSided := []Sample{{T: t0 - 1*minute, Bids: []book.Level{lv(40, 5)}}}
	cases := map[string][]Sample{
		"empty":      nil,
		"after only": {quote(t0+1*second, 45, 47)},
		"one-sided":  oneSided,
	}
	for name, s := range cases {
		if _, ok := Move(s, t0); ok {
			t.Errorf("%s: move should be undefined", name)
		}
		if _, ok := TimeTo90(s, t0); ok {
			t.Errorf("%s: time to 90%% should be undefined", name)
		}
		if _, _, ok := Thinning(s, t0); ok {
			t.Errorf("%s: thinning should be undefined", name)
		}
	}
	if _, ok := SpreadAt(nil, t0); ok {
		t.Error("spread of no book should be undefined")
	}
}

// Book thinning: 10 min before, mid 40¢ (39/41) with levels at 39 (200), 38 (300), 37 (500)
// and 41 (200), 42 (300), 43 (400). Within 2¢ of 40 means 38–42: 200+300+200+300 = 1,000.
// 30 s before, the same mid with 50 at 39, 20 at 38, 50 at 41: 120. The 37 and 43 levels sit
// outside the 2¢ and don't count either time.
func TestThinning(t *testing.T) {
	s := []Sample{
		{T: t0 - 15*minute,
			Bids: []book.Level{lv(39, 200), lv(38, 300), lv(37, 500)},
			Asks: []book.Level{lv(41, 200), lv(42, 300), lv(43, 400)}},
		{T: t0 - 45*second,
			Bids: []book.Level{lv(39, 50), lv(38, 20), lv(37, 500)},
			Asks: []book.Level{lv(41, 50), lv(43, 400)}},
	}
	early, late, ok := Thinning(s, t0)
	if !ok || !near(early, 1000) || !near(late, 120) {
		t.Fatalf("thinning = %v %v %v, want 1000 120", early, late, ok)
	}
}

// Usual spread over a 14-minute window (t0 − 15 min to t0 − 1 min), worked by hand:
//   - from −20 min a 2¢ book (39/41) stands until −12 min: 3 min inside the window;
//   - −12 min: a burst of quotes 1 s apart at 1¢ (40/41, ten of them): 10 s in all;
//   - −11:50: 3¢ (39/42) until −10 min: 1 min 50 s;
//   - −10 min: one-sided (no ask) until −9 min: 1 min, doesn't count;
//   - −9 min: 2¢ (40/42) to the end of the window, −1 min: 8 min.
//
// Counted time 3:00 + 0:10 + 1:50 + 8:00 = 13 min; half is 6.5 min. Sorted: 1¢ for 10 s, then
// 2¢ for 11 min: the running total passes 6.5 min inside the 2¢ stretch, so the median is 2¢.
// One vote per change would say 1¢ (ten of the fourteen changes), which is the point of weighting.
func TestUsualSpread(t *testing.T) {
	s := []Sample{quote(t0-20*minute, 39, 41)}
	for i := range int64(10) {
		s = append(s, quote(t0-12*minute+i*second, 40, 41))
	}
	s = append(s, quote(t0-11*minute-50*second, 39, 42),
		Sample{T: t0 - 10*minute, Bids: []book.Level{lv(40, 100)}},
		quote(t0-9*minute, 40, 42),
		quote(t0-30*second, 45, 50)) // after the window: ignored
	if sp, ok := UsualSpread(s, t0-15*minute, t0-minute); !ok || !near(sp, 2) {
		t.Fatalf("usual spread = %v %v, want 2", sp, ok)
	}
	// 3¢ for 2 min then 1¢ for 1 min: 1¢ stood only a third of the time, so 3¢.
	s = []Sample{quote(t0-3*minute, 39, 42), quote(t0-minute, 40, 41)}
	if sp, ok := UsualSpread(s, t0-3*minute, t0); !ok || !near(sp, 3) {
		t.Fatalf("usual spread = %v %v, want 3", sp, ok)
	}
	// Only a one-sided book, or nothing before the window ends: undefined.
	if _, ok := UsualSpread(s[1:], t0-3*minute, t0-minute); ok {
		t.Fatal("usual spread defined with no book in the window")
	}
}

// Near drops the levels more than 2¢ from the mid but keeps each side's best, and reads the
// same as the full book. Mid 40¢ (39/41): bids 39, 38 (in), 37.5 (out); asks 41, 42 (in), 43 (out).
func TestNearKeepsWhatTheFunctionsRead(t *testing.T) {
	full := Sample{T: 5,
		Bids: []book.Level{lv(39, 10), lv(38, 20), lv(37.5, 30)},
		Asks: []book.Level{lv(41, 1), lv(42, 2), lv(43, 3)}}
	n := Near(full)
	if len(n.Bids) != 2 || len(n.Asks) != 2 || n.T != 5 {
		t.Fatalf("near kept %d bids, %d asks", len(n.Bids), len(n.Asks))
	}
	d1, _ := full.Depth()
	d2, _ := n.Depth()
	if !near(d1, 33) || !near(d2, 33) {
		t.Fatalf("depth full %v near %v, want 33", d1, d2)
	}
	// A 10¢ spread: the best levels are 5¢ from the mid but stay.
	wide := Near(quote(0, 35, 45))
	if sp, ok := wide.Spread(); !ok || !near(sp, 10) {
		t.Fatalf("wide spread = %v %v", sp, ok)
	}
	if one := Near(Sample{Bids: []book.Level{lv(40, 1)}}); len(one.Bids) != 0 {
		t.Fatal("one-sided book kept levels")
	}
}
