package main

import (
	"testing"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

func TestFamilyOf(t *testing.T) {
	for _, c := range []struct {
		venue, msg, family, contract string
	}{
		{"kalshi", `{"type":"orderbook_delta","sid":1,"msg":{"market_ticker":"KXINXU-26NOV16H1000-T7544.9999","price_dollars":"0.84"}}`, "KXINXU", "KXINXU-26NOV16H1000-T7544.9999"},
		{"kalshi", `{"ticker":"KXBTCD-26NOV1617-T95999.99","book":{}}`, "KXBTCD", "KXBTCD-26NOV1617-T95999.99"},
		{"deribit", `{"params":{"channel":"ticker.ETH-17NOV26-1960-C.agg2","data":{}}}`, "ETH", "ETH-17NOV26-1960-C"},
		{"deribit", `{"params":{"channel":"deribit_price_index.btc_usd","data":{}}}`, "BTC", ""},
		{"deribit", `{"params":{"channel":"markprice.options.eth_usd","data":[]}}`, "ETH", ""},
		{"coinbase", `{"type":"ticker"}`, "spot", "coinbase"},
	} {
		f, k := familyOf(rawlog.Record{Venue: c.venue, Msg: []byte(c.msg)})
		if f != c.family || k != c.contract {
			t.Errorf("%s %s: got (%q, %q), want (%q, %q)", c.venue, c.msg, f, k, c.family, c.contract)
		}
	}
}

func TestHourOf(t *testing.T) {
	want := time.Date(2026, 11, 16, 14, 0, 0, 0, time.UTC)
	for _, p := range []string{"kalshi/2026-11-16/14-0003.jsonl.gz", "kalshi/2026-11-16/14.jsonl.gz"} {
		if got := hourOf(p); !got.Equal(want) {
			t.Errorf("%s: %v, want %v", p, got, want)
		}
	}
}
