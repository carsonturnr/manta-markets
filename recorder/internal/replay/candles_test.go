package replay

import "testing"

func TestCandles(t *testing.T) {
	const m0 = int64(1_795_000_020_000) // a minute boundary in unix ms (divisible by 60,000)
	lv := func(p float64) [][2]float64 { return [][2]float64{{p, 10}} }
	minutes := []Minute{
		{T: m0, Bids: lv(0.40), Asks: lv(0.42)},
		{T: m0 + 60000, Bids: lv(0.44), Asks: lv(0.46)},
		{T: m0 + 120000, Bids: nil, Asks: lv(0.47)},      // one-sided: no candle
		{T: m0 + 240000, Bids: lv(0.45), Asks: lv(0.47)}, // the boundary before is missing
	}
	trades := []Trade{
		{T: m0 + 5000, Side: "yes", Px: 0.41, Sz: 3},
		{T: m0 + 30000, Side: "yes", Px: 0.43, Sz: 2},
		{T: m0 + 59999, Side: "no", Px: 0.42, Sz: 1},
		{T: m0 + 241000, Side: "yes", Px: 0.46, Sz: 5},
	}
	got := Candles(minutes, trades)
	if len(got) != 3 {
		t.Fatalf("want 3 candles, got %d: %+v", len(got), got)
	}
	// First minute: bid 0.40 → 0.44 at the next boundary; trades 0.41, 0.43, 0.42.
	c := got[0]
	if c.Time != m0/1000 || c.Bid != [4]float64{0.40, 0.44, 0.40, 0.44} || c.Ask != [4]float64{0.42, 0.46, 0.42, 0.46} {
		t.Errorf("first candle = %+v", c)
	}
	if c.Trade == nil || *c.Trade != [4]float64{0.41, 0.43, 0.41, 0.42} || c.Volume != 6 {
		t.Errorf("first candle trades = %v volume %v", c.Trade, c.Volume)
	}
	// Second minute: the next boundary is one-sided, so the quote stays flat; no trades.
	c = got[1]
	if c.Bid != [4]float64{0.44, 0.44, 0.44, 0.44} || c.Trade != nil || c.Volume != 0 {
		t.Errorf("second candle = %+v", c)
	}
	// Last: no next boundary, flat; its trade counted.
	c = got[2]
	if c.Time != (m0+240000)/1000 || c.Ask != [4]float64{0.47, 0.47, 0.47, 0.47} || c.Volume != 5 {
		t.Errorf("last candle = %+v", c)
	}
}
