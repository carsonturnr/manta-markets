package tap

import (
	"slices"
	"testing"
	"time"
)

func TestNearMoneyPicksNearExpiryNearStrike(t *testing.T) {
	now := time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC)
	exp := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }
	insts := []deribitInstrument{
		{"BTC-13NOV26-72000-C", exp(17 * time.Hour), 72000},     // tomorrow, at the money: in
		{"BTC-13NOV26-90000-C", exp(17 * time.Hour), 90000},     // too far out of the money
		{"BTC-14NOV26-65000-P", exp(41 * time.Hour), 65000},     // within ±15% of 72,000: in
		{"BTC-20NOV26-72000-C", exp(8 * 24 * time.Hour), 72000}, // beyond 2 days
		{"BTC-12NOV26-72000-C", exp(-time.Hour), 72000},         // already expired
	}
	got := nearMoney(insts, now, 2, 72000, 0.15)
	want := []string{"BTC-13NOV26-72000-C", "BTC-14NOV26-65000-P"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
