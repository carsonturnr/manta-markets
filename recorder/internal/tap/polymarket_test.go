package tap

import (
	"slices"
	"testing"
	"time"
)

func TestPolymarketSlugsUseNewYorkDate(t *testing.T) {
	// 02:00 UTC on Nov 14 is still Nov 13 in New York: today's contracts are the Nov 13 ones.
	now := time.Date(2026, 11, 14, 2, 0, 0, 0, time.UTC)
	got := polymarketSlugs("bitcoin-above-on-%s", now, 2)
	want := []string{"bitcoin-above-on-november-13-2026", "bitcoin-above-on-november-14-2026"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestPolymarketSlugsCrossMonthAndYear(t *testing.T) {
	now := time.Date(2026, 12, 31, 18, 0, 0, 0, time.UTC)
	got := polymarketSlugs("bitcoin-above-on-%s", now, 2)
	if got[1] != "bitcoin-above-on-january-1-2027" {
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
		{[]string{"bitcoin", "crypto", "crypto-prices", "weekly"}, true}, // want: bitcoin, crypto
		{[]string{"bitcoin"}, false},                                     // not tagged crypto
		{[]string{"crypto", "ethereum"}, false},                          // not bitcoin
		{[]string{"bitcoin", "crypto", "sports"}, false},                 // anything sports-related
		{[]string{"bitcoin", "crypto", "esports"}, false},
	} {
		if ok, _ := polymarketAllowed(event(c.tags...), []string{"bitcoin", "crypto"}); ok != c.ok {
			t.Errorf("tags %v: allowed = %v, want %v", c.tags, ok, c.ok)
		}
	}
}

// The economics families pick events by slug pattern from a broad tag listing: real slugs
// (2026-11-15) that must and must not match.
func TestPolymarketEconomicsSlugs(t *testing.T) {
	matched := func(slug string) []string {
		var tags []string
		for _, f := range polymarketFamilies {
			if f.slug != nil && f.slug.MatchString(slug) {
				tags = append(tags, f.tags...)
			}
		}
		return tags
	}
	for _, c := range []struct {
		slug string
		ok   bool
	}{
		{"fed-decision-in-december-20260729232808632", true},
		{"fed-decision-in-march-2027", true},
		{"fed-decisions-sepdec", false}, // a parlay of several meetings
		{"november-inflation-us-annual", true},
		{"november-inflation-us-monthly", true},
		{"south-africa-annual-inflation-2026", false},
		{"price-of-dozen-eggs-in-november-2026", false},
		{"november-unemployment-rate-2026", true},
		{"november-2026-unemployment-rate-canada", false},
		{"how-many-jobs-added-in-november-2026", true},
	} {
		if got := len(matched(c.slug)) > 0; got != c.ok {
			t.Errorf("%s: matched = %v, want %v", c.slug, got, c.ok)
		}
	}
}

func TestPolymarketFamily(t *testing.T) {
	for slug, want := range map[string]string{
		"bitcoin-above-on-november-16-2026":          "btc-above",
		"ethereum-price-on-november-17-2026":         "eth-price",
		"fed-decision-in-december-20260729232808632": "fed-decision",
		"november-inflation-us-monthly":              "cpi",
		"how-many-jobs-added-in-november-2026":       "payrolls",
		"south-africa-annual-inflation-2026":         "",
		"super-bowl-champion-2027":                   "",
	} {
		if got := PolymarketFamily(slug); got != want {
			t.Errorf("%s: family %q, want %q", slug, got, want)
		}
	}
}
