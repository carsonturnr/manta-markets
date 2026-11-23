package main

import (
	"fmt"
	"testing"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/eventresponse"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
)

func quote(t int64, bid, ask float64) eventresponse.Sample {
	lv := func(c float64) []book.Level {
		return []book.Level{{Px: int64(c * float64(fixed.Scale) / 100), Sz: fixed.Scale}}
	}
	return eventresponse.Sample{T: t, Bids: lv(bid), Asks: lv(ask)}
}

// Mids 40 at 0.1 s; 41 at 1.2 s then 42 at 1.7 s (same second: the last, 42, stands, stamped
// 1.7 s); 42 again at 2.5 s (no change: no point); a one-sided moment at 3 s, then 42 at 3.2 s
// (back to the same mid: no point); 41 at 4.1 s then 42 at 4.6 s (the second ends where it
// began: no point).
func TestMidSeries(t *testing.T) {
	got := midSeries([]eventresponse.Sample{
		quote(100, 39, 41), quote(1200, 40, 42), quote(1700, 41, 43), quote(2500, 41, 43),
		{T: 3000}, quote(3200, 41, 43), quote(4100, 40, 42), quote(4600, 41, 43),
	})
	if want := "[[100 40] [1700 42]]"; fmt.Sprint(got) != want {
		t.Fatalf("mids %v, want %s", got, want)
	}
}
