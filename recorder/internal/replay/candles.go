package replay

// Candle is one minute of one market built from Manta's own recording, in the shape the site's
// charts already read from Kalshi's candlestick API (site/lib/candles.ts KalshiCandle): open,
// high, low, close of the best "yes" bid, the best "yes" ask and the trades, in dollars, and the
// contracts traded. Time is the minute's start in unix seconds.
type Candle struct {
	Time   int64       `json:"time"`
	Bid    [4]float64  `json:"bid"`
	Ask    [4]float64  `json:"ask"`
	Trade  *[4]float64 `json:"trade"` // nil: no trade in the minute
	Volume float64     `json:"volume"`
}

// Candles turns one market's recorded minutes (its book at each minute boundary, in time order)
// and trades into 1-minute candles. The replay keeps the book only at the boundaries, so a
// minute's bid and ask run from the boundary at its start to the one at its end (or stay flat
// when the next boundary is missing), and their high and low are the larger and smaller of the
// two: a minute that spiked and came back inside it shows flat. A minute whose book had no bid
// or no ask at its start has no candle; the site carries the last price through it.
func Candles(minutes []Minute, trades []Trade) []Candle {
	byMinute := map[int64][]Trade{}
	for _, t := range trades {
		start := t.T / 60000 * 60000
		byMinute[start] = append(byMinute[start], t)
	}
	var out []Candle
	for i, m := range minutes {
		if len(m.Bids) == 0 || len(m.Asks) == 0 {
			continue
		}
		bid0, ask0 := m.Bids[0][0], m.Asks[0][0]
		bid1, ask1 := bid0, ask0
		if i+1 < len(minutes) {
			n := minutes[i+1]
			if n.T == m.T+60000 && len(n.Bids) > 0 && len(n.Asks) > 0 {
				bid1, ask1 = n.Bids[0][0], n.Asks[0][0]
			}
		}
		c := Candle{Time: m.T / 1000, Bid: ohlc(bid0, bid1), Ask: ohlc(ask0, ask1)}
		if ts := byMinute[m.T]; len(ts) > 0 {
			p := [4]float64{ts[0].Px, ts[0].Px, ts[0].Px, ts[len(ts)-1].Px}
			for _, t := range ts {
				p[1] = max(p[1], t.Px)
				p[2] = min(p[2], t.Px)
				c.Volume += t.Sz
			}
			c.Trade = &p
		}
		out = append(out, c)
	}
	return out
}

func ohlc(open, close float64) [4]float64 {
	return [4]float64{open, max(open, close), min(open, close), close}
}
