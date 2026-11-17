package replay

import (
	"reflect"
	"testing"

	"github.com/carsonturnr/manta-markets/recorder/internal/md"
)

const (
	t0  = int64(1_795_000_000) * 1e9 // a minute boundary (unix ns)
	sec = int64(1e9)
	mkt = "KXBTCD-26NOV1717-T64000"
)

func snap(ts int64, id string, bids, asks [][2]string) *md.Book {
	return &md.Book{MarketID: id, RecvTs: ts, Kind: md.Snapshot, Bids: bids, Asks: asks, Source: "ws"}
}

func delta(ts int64, id string, bids, asks [][2]string) *md.Book {
	return &md.Book{MarketID: id, RecvTs: ts, Kind: md.Delta, Bids: bids, Asks: asks, Source: "ws"}
}

func TestMinutesRecordTheBookJustBeforeEachBoundary(t *testing.T) {
	b := New([]string{"KXBTCD-"}, t0, t0+3*minuteNs, 2)
	// Warm-up: a snapshot before the hour, then a change.
	b.Handle(snap(t0-30*sec, mkt, [][2]string{{"0.40", "10"}, {"0.39", "5"}, {"0.38", "7"}}, [][2]string{{"0.42", "8"}}))
	b.Handle(delta(t0-10*sec, mkt, [][2]string{{"0.41", "3"}}, nil))
	// After the first boundary: the best bid is taken out.
	b.Handle(delta(t0+20*sec, mkt, [][2]string{{"0.41", "0"}}, nil))
	b.Finish()

	got := b.Out[mkt].Minutes
	want := []Minute{
		// 0.41 joined before the boundary; three bid levels exist but only two are kept.
		{T: t0 / 1e6, Bids: [][2]float64{{0.41, 3}, {0.40, 10}}, Asks: [][2]float64{{0.42, 8}}},
		{T: (t0 + minuteNs) / 1e6, Bids: [][2]float64{{0.40, 10}, {0.39, 5}}, Asks: [][2]float64{{0.42, 8}}},
		{T: (t0 + 2*minuteNs) / 1e6, Bids: [][2]float64{{0.40, 10}, {0.39, 5}}, Asks: [][2]float64{{0.42, 8}}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("minutes:\n got %v\nwant %v", got, want)
	}
}

func TestAGapHidesTheMarketUntilItsNextSnapshot(t *testing.T) {
	b := New([]string{"KXBTCD-"}, t0, t0+3*minuteNs, 1)
	b.Handle(snap(t0-sec, mkt, [][2]string{{"0.40", "10"}}, [][2]string{{"0.42", "8"}}))
	id := mkt
	b.Handle(&md.Status{Ts: t0 + 10*sec, State: md.Gap, MarketID: &id})
	b.Handle(snap(t0+minuteNs+10*sec, mkt, [][2]string{{"0.45", "1"}}, [][2]string{{"0.47", "2"}}))
	b.Finish()
	var ts []int64
	for _, m := range b.Out[mkt].Minutes {
		ts = append(ts, m.T)
	}
	// Recorded at t0 (before the gap) and t0+2m (after the new snapshot); not at t0+1m.
	if want := []int64{t0 / 1e6, (t0 + 2*minuteNs) / 1e6}; !reflect.DeepEqual(ts, want) {
		t.Fatalf("recorded at %v, want %v", ts, want)
	}
}

func TestTradesOnlyInsideTheHourAndRESTBooksIgnored(t *testing.T) {
	b := New([]string{"KXBTCD-"}, t0, t0+minuteNs, 1)
	b.Handle(&md.Trade{MarketID: mkt, RecvTs: t0 - sec, Side: "buy", Px: "0.41", Sz: "5"})
	b.Handle(&md.Trade{MarketID: mkt, RecvTs: t0 + sec, Side: "sell", Px: "0.40", Sz: "2.5"})
	b.Handle(&md.Trade{MarketID: "KXINX-26NOV17H1200-T7000", RecvTs: t0 + sec, Side: "buy", Px: "0.5", Sz: "1"})
	b.Handle(&md.Book{MarketID: mkt, RecvTs: t0 + 2*sec, Kind: md.Snapshot, Source: "rest",
		Bids: [][2]string{{"0.10", "1"}}})
	b.Finish()
	if got := b.Out[mkt].Trades; !reflect.DeepEqual(got, []Trade{{T: (t0 + sec) / 1e6, Side: "sell", Px: 0.40, Sz: 2.5}}) {
		t.Fatalf("trades: %v", got)
	}
	if len(b.Out[mkt].Minutes) != 0 || len(b.Out) != 1 {
		t.Fatalf("a REST book was used, or another series recorded: %v", b.Out)
	}
}

func TestEvent(t *testing.T) {
	if got := Event("KXBTCD-26NOV1717-T73749.99"); got != "KXBTCD-26NOV1717" {
		t.Fatal(got)
	}
}

func TestAClearedBookIsNotRecorded(t *testing.T) {
	b := New([]string{"KXBTCD-"}, t0, t0+minuteNs, 1)
	b.Handle(snap(t0-sec, mkt, [][2]string{}, [][2]string{}))
	b.Finish()
	if m := b.Out[mkt]; m != nil {
		t.Fatalf("a cleared book was recorded: %v", m)
	}
}
