package news

import (
	"fmt"
	"testing"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

func ms(s string) int64 {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t.UnixMilli()
}

func TestKeyAndT0(t *testing.T) {
	it := Item{Source: "fed-press", ID: "https://www.federalreserve.gov/newsevents/pressreleases/bcreg20261125b.htm",
		StatedMs: ms("2026-11-25T20:00:00Z"), StatedReal: true, ReceivedMs: ms("2026-11-25T20:00:31Z")}
	// sha256 of the id starts ebcc18ee… (checked with `printf %s <id> | shasum -a 256`).
	if k := Key(it); k != "2026-11-25-fed-press-ebcc18ee" {
		t.Errorf("key %s", k)
	}
	if t0, kind, ok := T0(it); !ok || kind != "stated" || t0 != it.StatedMs {
		t.Errorf("Fed: %d %s %v", t0, kind, ok)
	}
	it.StatedReal = false // a DOL item: measured from our receipt
	if t0, kind, ok := T0(it); !ok || kind != "received" || t0 != it.ReceivedMs {
		t.Errorf("DOL: %d %s %v", t0, kind, ok)
	}
	it.Backfill = true // received while we were down, at an unknown time: no t0 at all
	if _, _, ok := T0(it); ok {
		t.Error("backfill with no real stated time must have no t0")
	}
}

func TestAtRelease(t *testing.T) {
	rs := []Release{
		{"2026-12-10-cpi", ms("2026-12-10T13:30:00Z"), ReleaseAgency("2026-12-10-cpi")},
		{"2026-12-09-fed", ms("2026-12-09T19:00:00Z"), ReleaseAgency("2026-12-09-fed")},
	}
	if rs[0].Agency != "bls" || rs[1].Agency != "fed" || ReleaseAgency("2026-12-25-gdp") != "" {
		t.Fatalf("agencies %+v", rs)
	}
	cases := []struct{ source, at, want string }{
		{"bls-cpi", "2026-12-10T13:30:20Z", "2026-12-10-cpi"},   // the BLS headline, received 20 s after
		{"fed-press", "2026-12-09T19:00:00Z", "2026-12-09-fed"}, // the FOMC statement's stated time
		{"bls-cpi", "2026-12-10T13:39:59Z", "2026-12-10-cpi"},
		{"bls-cpi", "2026-12-10T13:40:00Z", ""},      // 10 minutes after: its own move
		{"bls-cpi", "2026-12-10T13:29:59Z", ""},      // before the release
		{"fed-speech", "2026-12-10T13:35:00Z", ""},   // another agency just after CPI
		{"bls-payrolls", "2026-12-09T19:00:00Z", ""}, // BLS at the Fed's minute
	}
	for _, c := range cases {
		if got, _ := AtRelease(c.source, ms(c.at), rs); got != c.want {
			t.Errorf("%s at %s: %q, want %q", c.source, c.at, got, c.want)
		}
	}
}

func TestMoves(t *testing.T) {
	t0 := ms("2026-11-27T14:40:25Z") // a receipt time: the move starts at the 14:40 boundary
	from, to := Window(t0)
	if from != ms("2026-11-27T14:10:00Z") || to != ms("2026-11-27T15:10:00Z") {
		t.Fatalf("window %d %d", from, to)
	}
	min := func(at string, bid, ask float64) replay.Minute {
		m := replay.Minute{T: ms(at)}
		if bid > 0 {
			m.Bids = [][2]float64{{bid, 10}, {bid - 0.01, 50}}
		}
		if ask > 0 {
			m.Asks = [][2]float64{{ask, 10}}
		}
		return m
	}
	got := Moves(t0, map[string][]replay.Minute{
		// 41¢ at 14:40 ((0.40 + 0.42) / 2), 47¢ at 15:10: +6¢; 38¢ at 14:10: +3¢ before.
		// Files come hour by hour, in any order; 14:09 and 15:11 are outside the window.
		"KXFED-26DEC-T3.75": {min("2026-11-27T15:10:00Z", 0.46, 0.48), min("2026-11-27T14:25:00Z", 0.39, 0.41),
			min("2026-11-27T14:40:00Z", 0.40, 0.42), min("2026-11-27T15:11:00Z", 0.10, 0.12),
			min("2026-11-27T14:10:00Z", 0.37, 0.39), min("2026-11-27T14:09:00Z", 0.20, 0.22)},
		// 50¢ → 50.5¢: a move under 1¢ keeps no chart line.
		"KXINXU-26NOV27H1600-T6800": {min("2026-11-27T14:40:00Z", 0.49, 0.51), min("2026-11-27T15:10:00Z", 0.50, 0.51)},
		// No ask at +30 min: no move, still listed.
		"KXBTCD-26NOV2711-T90000": {min("2026-11-27T14:40:00Z", 0.30, 0.32), min("2026-11-27T15:10:00Z", 0.30, 0)},
		// Only outside the window: left out.
		"KXETHD-26NOV2711-T3000": {min("2026-11-27T14:09:00Z", 0.30, 0.32)},
	})
	if len(got) != 3 {
		t.Fatalf("%d contracts: %+v", len(got), got)
	}
	a, b, c := got[0], got[1], got[2]
	if a.Ticker != "KXFED-26DEC-T3.75" || a.Event != "KXFED-26DEC" || *a.MoveCents != 6 || *a.BeforeCents != 3 ||
		len(a.Mids) != 4 || a.Mids[0] != [2]float64{float64(ms("2026-11-27T14:10:00Z")), 38} {
		t.Errorf("first: %+v", a)
	}
	if b.Ticker != "KXINXU-26NOV27H1600-T6800" || *b.MoveCents != 0.5 || b.Mids != nil {
		t.Errorf("second: %+v", b)
	}
	if b.BeforeCents != nil { // no mid at 14:10
		t.Errorf("second's baseline: %v", *b.BeforeCents)
	}
	if c.Ticker != "KXBTCD-26NOV2711-T90000" || c.MoveCents != nil {
		t.Errorf("third: %+v", c)
	}
}

// Only the Charted biggest movers keep a chart line.
func TestMovesCharted(t *testing.T) {
	t0 := ms("2026-11-27T14:40:00Z")
	minutes := map[string][]replay.Minute{}
	for i := range Charted + 5 {
		p := 0.10 + float64(i)/100 // contract i moves i + 1 cents
		minutes[fmt.Sprintf("KXBTCD-26NOV2711-T%d", i)] = []replay.Minute{
			{T: t0, Bids: [][2]float64{{p, 1}}, Asks: [][2]float64{{p, 1}}},
			{T: t0 + MoveAfter.Milliseconds(), Bids: [][2]float64{{p + float64(i+1)/100, 1}}, Asks: [][2]float64{{p + float64(i+1)/100, 1}}}}
	}
	charted := 0
	for _, m := range Moves(t0, minutes) {
		if m.Mids != nil {
			charted++
		}
	}
	if charted != Charted {
		t.Fatalf("%d charted, want %d", charted, Charted)
	}
}
