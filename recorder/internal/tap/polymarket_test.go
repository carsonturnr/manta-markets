package tap

import (
	"slices"
	"testing"
	"time"
)

func TestPolymarketSlugsUseNewYorkDate(t *testing.T) {
	// 02:00 UTC on Nov 14 is still Nov 13 in New York: today's contracts are the Nov 13 ones.
	now := time.Date(2026, 11, 14, 2, 0, 0, 0, time.UTC)
	got := polymarketSlugs(now, 2)
	want := []string{
		"bitcoin-above-on-november-13-2026", "bitcoin-price-on-november-13-2026",
		"bitcoin-above-on-november-14-2026", "bitcoin-price-on-november-14-2026",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPolymarketSlugsCrossMonthAndYear(t *testing.T) {
	now := time.Date(2026, 12, 31, 18, 0, 0, 0, time.UTC)
	got := polymarketSlugs(now, 2)
	if got[2] != "bitcoin-above-on-january-1-2027" {
		t.Fatalf("got %v", got)
	}
}

func TestPolymarketAllowed(t *testing.T) {
	event := func(tags ...string) polymarketEvent {
		var e polymarketEvent
		for _, s := range tags {
			e.Tags = append(e.Tags, struct {
				Slug string `json:"slug"`
			}{s})
		}
		return e
	}
	for _, c := range []struct {
		tags []string
		ok   bool
	}{
		{[]string{"bitcoin", "crypto", "crypto-prices", "weekly"}, true},
		{[]string{"bitcoin"}, false},                     // not tagged crypto
		{[]string{"crypto", "ethereum"}, false},          // not bitcoin
		{[]string{"bitcoin", "crypto", "sports"}, false}, // anything sports-related
		{[]string{"bitcoin", "crypto", "esports"}, false},
	} {
		if ok, _ := polymarketAllowed(event(c.tags...)); ok != c.ok {
			t.Errorf("tags %v: allowed = %v, want %v", c.tags, ok, c.ok)
		}
	}
}
