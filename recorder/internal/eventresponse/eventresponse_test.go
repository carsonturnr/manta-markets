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
