package main

import (
	"testing"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/news"
)

func TestFresh(t *testing.T) {
	src := news.Source{Name: "fed-press", StatedReal: true}
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	ms := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	seen := map[string]bool{"fed-press\x00old-seen": true}
	items := []news.Item{
		{ID: "a", StatedMs: ms(time.Hour)},
		{ID: "a", StatedMs: ms(time.Hour)},                 // the feed repeats it: kept once
		{ID: "old-seen", StatedMs: ms(time.Hour)},          // recorded before a restart
		{ID: "ancient", StatedMs: ms(30 * 24 * time.Hour)}, // older than a week: only marked seen
	}
	got := fresh(src, items, seen, true, now)
	if len(got) != 1 || got[0].ID != "a" || !got[0].Backfill || got[0].Source != "fed-press" ||
		!got[0].StatedReal || got[0].ReceivedMs != now.UnixMilli() {
		t.Fatalf("first poll: %+v", got)
	}
	if !seen["fed-press\x00ancient"] {
		t.Fatal("an old item must be marked seen, or every poll would look at it again")
	}
	// Later polls: only the new item, with a real receipt time.
	items = append(items, news.Item{ID: "b", StatedMs: ms(20 * time.Second)})
	got = fresh(src, items, seen, false, now)
	if len(got) != 1 || got[0].ID != "b" || got[0].Backfill || got[0].ReceivedMs-got[0].StatedMs != 20_000 {
		t.Fatalf("later poll: %+v", got)
	}
}

func TestCount(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	var s summary
	s.count([]news.Move{
		{Ticker: "A", MoveCents: f(-6), BeforeCents: f(0.5)}, // biggest first, as news.Moves sorts
		{Ticker: "B", MoveCents: f(2), BeforeCents: f(-3)},
		{Ticker: "C", MoveCents: f(0.5), BeforeCents: nil}, // no baseline: out of both counts
		{Ticker: "D", MoveCents: nil, BeforeCents: f(4)},
		{Ticker: "E", MoveCents: f(0), BeforeCents: f(1)},
	})
	if s.Top != "A" || *s.TopCents != -6 || s.Contracts != 3 || s.Moved != 2 || s.MovedBefore != 2 {
		t.Fatalf("%+v", s)
	}
}
