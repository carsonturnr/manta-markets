package normalize

import (
	"encoding/json"
	"strconv"
	"testing"

	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

func rec(venue, stream string, ns int64, msg string) rawlog.Record {
	return rawlog.Record{RecvNs: ns, Venue: venue, Stream: stream, Msg: json.RawMessage(msg)}
}

func play(t *testing.T, n Normalizer, recs ...rawlog.Record) []md.Msg {
	t.Helper()
	var out []md.Msg
	for _, r := range recs {
		out = append(out, n.Handle(r)...)
	}
	return out
}

func TestKalshiNoBidsBecomeYesAsks(t *testing.T) {
	n, _ := New("kalshi")
	msg := `{"ticker":"KX-1","book":{"orderbook_fp":{"yes_dollars":[["0.3000","10.00"]],"no_dollars":[["0.6500","4.00"]]}}}`
	out := play(t, n, rec("kalshi", "orderbook", 1, msg), rec("kalshi", "orderbook", 2, msg))
	if len(out) != 1 {
		t.Fatalf("unchanged poll republished: %d msgs", len(out))
	}
	b := out[0].(*md.Book)
	if b.Bids[0] != [2]string{"0.3", "10"} || b.Asks[0] != [2]string{"0.35", "4"} {
		t.Fatalf("book %+v", b)
	}
}

func TestKalshiPollErrorMarksMarketStale(t *testing.T) {
	n, _ := New("kalshi")
	ob := `{"ticker":"KX-1","book":{"orderbook_fp":{"yes_dollars":[],"no_dollars":[]}}}`
	play(t, n,
		rec("kalshi", "orderbook", 0, ob),
		rec("kalshi", "status", 50, `{"state":"poll_error","detail":"KX-1: timeout"}`),
		rec("kalshi", "orderbook", 75, ob),
		rec("kalshi", "orderbook", 100, ob),
	)
	if c := n.Stats().CoveragePct; c != 75 {
		t.Fatalf("coverage %.2f%%", c)
	}
}

func kws(typ string, seq int, msg string) string {
	return `{"type":"` + typ + `","sid":1,"seq":` + strconv.Itoa(seq) + `,"msg":` + msg + `}`
}

const kSnap = `{"market_ticker":"KX-1","yes_dollars_fp":[["0.3000","10.00"]],"no_dollars_fp":[["0.6500","4.00"]]}`

func kDelta(px, d, side string) string {
	return `{"market_ticker":"KX-1","price_dollars":"` + px + `","delta_fp":"` + d + `","side":"` + side + `","ts_ms":7}`
}

const sec = int64(1e9)

func TestKalshiWebSocketBook(t *testing.T) {
	n, _ := New("kalshi")
	out := play(t, n,
		rec("kalshi", "subscribe", 0, `{"label":"conn 0 (1 markets)","frames":["{}"]}`),
		rec("kalshi", "ws", 1, kws("orderbook_snapshot", 1, kSnap)),
		rec("kalshi", "ws", 2, kws("orderbook_delta", 2, kDelta("0.3000", "-4.00", "yes"))),
		rec("kalshi", "ws", 3, kws("orderbook_delta", 3, kDelta("0.6000", "2.50", "no"))),
	)
	snap := out[0].(*md.Book)
	if snap.Bids[0] != [2]string{"0.3", "10"} || snap.Asks[0] != [2]string{"0.35", "4"} {
		t.Fatalf("snapshot %+v", snap)
	}
	if d := out[1].(*md.Book); d.Kind != md.Delta || d.Bids[0] != [2]string{"0.3", "6"} || *d.VenueSeq != 2 {
		t.Fatalf("yes delta %+v", d)
	}
	if d := out[2].(*md.Book); d.Asks[0] != [2]string{"0.4", "2.5"} || *d.VenueTsMs != 7 {
		t.Fatalf("no delta becomes a YES ask %+v", d)
	}
	if s := n.Stats(); s.DeltaChecks != 2 || s.DeltaMismatches != 0 || s.CoveragePct != 100 {
		t.Fatalf("stats %+v", s)
	}
}

func TestKalshiSeqGapAndNegativeLevel(t *testing.T) {
	n, _ := New("kalshi")
	play(t, n,
		rec("kalshi", "subscribe", 0, `{"label":"c","frames":[]}`),
		rec("kalshi", "ws", 0, kws("orderbook_snapshot", 1, kSnap)),
		rec("kalshi", "ws", 50, kws("orderbook_delta", 3, kDelta("0.3000", "1.00", "yes"))), // seq 2 lost
		rec("kalshi", "ws", 100, kws("orderbook_delta", 4, kDelta("0.3000", "1.00", "yes"))),
	)
	if s := n.Stats(); s.Gaps != 1 || s.CoveragePct != 50 {
		t.Fatalf("seq gap: %+v", s)
	}

	n, _ = New("kalshi")
	out := play(t, n,
		rec("kalshi", "subscribe", 0, `{"label":"c","frames":[]}`),
		rec("kalshi", "ws", 0, kws("orderbook_snapshot", 1, kSnap)),
		rec("kalshi", "ws", 1, kws("orderbook_delta", 2, kDelta("0.3000", "-11.00", "yes"))),
	)
	if s := n.Stats(); s.DeltaMismatches != 1 {
		t.Fatalf("negative level: %+v", s)
	}
	if st := out[1].(*md.Status); st.State != md.Gap {
		t.Fatalf("no gap status: %+v", out[1])
	}
}

func TestKalshiRestComparedOnlyWhenQuiet(t *testing.T) {
	n, _ := New("kalshi")
	rest := func(ns int64, yes string) rawlog.Record {
		return rec("kalshi", "orderbook", ns, `{"ticker":"KX-1","book":{"orderbook_fp":{"yes_dollars":`+yes+`,"no_dollars":[["0.6500","4.00"]]}}}`)
	}
	tick := func(ns int64) rawlog.Record { return rec("kalshi", "ws", ns, `{"type":"ok"}`) }
	out := play(t, n,
		rec("kalshi", "subscribe", 0, `{"label":"c","frames":[]}`),
		rec("kalshi", "ws", 0, kws("orderbook_snapshot", 1, kSnap)),
		rest(10*sec, `[["0.3000","10.00"]]`), tick(13*sec), // quiet, matches
		rest(20*sec, `[["0.3000","9.00"]]`), tick(23*sec), // quiet, disagrees
		rest(30*sec, `[["0.3000","10.00"]]`),
		rec("kalshi", "ws", 31*sec, kws("orderbook_delta", 2, kDelta("0.3000", "1.00", "yes"))), // inside the window
		tick(40*sec),
	)
	s := n.Stats()
	if s.RestCompares != 2 || s.RestMismatches != 1 || s.RestUnaligned != 1 {
		t.Fatalf("stats %+v", s)
	}
	for _, m := range out {
		if b, ok := m.(*md.Book); ok && b.Source == "rest" {
			t.Fatalf("REST adopted in WebSocket mode: %+v", b)
		}
	}
}

func TestKalshiTrade(t *testing.T) {
	n, _ := New("kalshi")
	out := play(t, n, rec("kalshi", "ws", 1, `{"type":"trade","sid":2,"msg":{"trade_id":"t1","market_ticker":"KX-1","yes_price_dollars":"0.3600","count_fp":"5.00","taker_side":"no","ts":1700000000}}`))
	tr := out[0].(*md.Trade)
	if tr.Side != "sell" || tr.Px != "0.36" || tr.Sz != "5" || *tr.VenueTsMs != 1700000000000 {
		t.Fatalf("trade %+v", tr)
	}
}

func TestFeedCoverageIsConnectedTime(t *testing.T) {
	n, _ := New("deribit")
	status := func(ns int64, state string) rawlog.Record {
		return rec("deribit", "status", ns, `{"state":"`+state+`","detail":"x"}`)
	}
	msg := func(ns int64) rawlog.Record { return rec("deribit", "ws", ns, `{"jsonrpc":"2.0"}`) }
	// Clean 0–60, disconnected 60–80, clean again from the next message at 80 until 100.
	play(t, n, status(0, "start"), msg(0), status(60, "disconnected"), status(70, "connected"), msg(80), msg(100))
	if s := n.Stats(); s.CoveragePct != 80 || s.Gaps != 2 {
		t.Fatalf("coverage %.2f%%, gaps %d", s.CoveragePct, s.Gaps)
	}
}

func TestUnknownVenue(t *testing.T) {
	if _, err := New("polymarket"); err == nil {
		t.Fatal("polymarket is not recorded yet")
	}
}

// A market left out of a new subscription closed: it is retired, not counted as stale until the
// end of the data. KX-1 is clean for 10 s, then dropped; coverage stays 100%.
func TestKalshiResubscribeRetiresDroppedMarkets(t *testing.T) {
	n, _ := New("kalshi")
	sub := func(ns int64, tickers string) rawlog.Record {
		frame, _ := json.Marshal(`{"cmd":"subscribe","params":{"market_tickers":[` + tickers + `]}}`)
		return rec("kalshi", "subscribe", ns, `{"label":"conn 0","frames":[`+string(frame)+`]}`)
	}
	play(t, n,
		sub(0, `"KX-1"`),
		rec("kalshi", "ws", 0, kws("orderbook_snapshot", 1, kSnap)),
		sub(10*sec, `"KX-2"`),
		rec("kalshi", "ws", 100*sec, kws("orderbook_snapshot", 1, `{"market_ticker":"KX-2","yes_dollars_fp":[],"no_dollars_fp":[]}`)),
	)
	if s := n.Stats(); s.CoveragePct != 100 {
		t.Fatalf("coverage %.2f%%: the dropped market still counts as stale", s.CoveragePct)
	}
}
