package md

import "testing"

func TestSubjects(t *testing.T) {
	cases := []struct{ got, want string }{
		{(&Book{Venue: "kalshi", MarketID: "KXIPOOPENAI-27JAN01"}).Subject(), "md.v1.kalshi.KXIPOOPENAI-27JAN01.book"},
		{(&Trade{Venue: "hyperliquid", MarketID: "io:OAI"}).Subject(), "md.v1.hyperliquid.io:OAI.trade"},
		{(&Book{Venue: "kalshi", MarketID: "KXFOO-26-T3.5"}).Subject(), "md.v1.kalshi.KXFOO-26-T3_5.book"},
		{(&Ctx{Venue: "hyperliquid", MarketID: "xyz:ANT"}).Subject(), "md.v1.hyperliquid.xyz:ANT.ctx"},
		{(&Status{Venue: "polymarket"}).Subject(), "md.v1.polymarket.status"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("got %q, want %q", c.got, c.want)
		}
	}
}
