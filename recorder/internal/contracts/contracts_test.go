package contracts

import (
	"encoding/json"
	"testing"
)

func f(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// Real market-list entries (2026-11-16), trimmed to the fields read.
func TestFromKalshi(t *testing.T) {
	for _, c := range []struct {
		series, raw         string
		payoff              string
		low, high, bid, ask any
	}{
		{"KXINXU", `{"ticker":"KXINXU-26NOV16H1600-T7324.9999","event_ticker":"KXINXU-26NOV16H1600","strike_type":"greater_or_equal","floor_strike":7325,"close_time":"2026-11-16T21:00:00Z","yes_bid_dollars":"0.9800","yes_bid_size_fp":"6195.00","yes_ask_dollars":"1.0000","yes_ask_size_fp":"0.00","volume_24h_fp":"0.00","open_interest_fp":"0.00","yes_sub_title":"7,325 or above"}`,
			"above", 7325.0, nil, 0.98, nil},
		{"KXBTC", `{"ticker":"KXBTC-26NOV1617-B74250","strike_type":"between","floor_strike":74200,"cap_strike":74299.99,"yes_bid_dollars":"0.0300","yes_bid_size_fp":"10.00","yes_ask_dollars":"0.0500","yes_ask_size_fp":"250.00"}`,
			"between", 74200.0, 74299.99, 0.03, 0.05},
		{"KXBTC", `{"ticker":"KXBTC-26NOV1617-T64000","strike_type":"less","cap_strike":64000}`,
			"below", nil, 64000.0, nil, nil},
		{"KXFEDDECISION", `{"ticker":"KXFEDDECISION-28JAN-H26","strike_type":"custom","custom_strike":{"Hike":">25"},"yes_sub_title":"Hike >25bps"}`,
			"outcome", nil, nil, nil, nil},
	} {
		got, err := FromKalshi(c.series, []byte(c.raw))
		if err != nil {
			t.Fatal(err)
		}
		if got.Inclusive != (got.ID == "KXINXU-26NOV16H1600-T7324.9999") {
			t.Errorf("%s: inclusive %v", got.ID, got.Inclusive)
		}
		if got.Payoff != c.payoff || f(got.Low) != c.low || f(got.High) != c.high || f(got.Bid) != c.bid || f(got.Ask) != c.ask {
			t.Errorf("%s: got %s %v–%v bid %v ask %v", got.ID, got.Payoff, f(got.Low), f(got.High), f(got.Bid), f(got.Ask))
		}
	}
	if _, err := FromKalshi("X", []byte(`{"ticker":"X-1","strike_type":"structured"}`)); err == nil {
		t.Error("an unknown strike type must be an error, not a guess")
	}
}

// Labels as Polymarket's families write them (2026-11-16).
func TestParseLabel(t *testing.T) {
	for _, c := range []struct {
		family, label, payoff string
		low, high             any
		inclusive             bool
	}{
		{"btc-above", "62,000", "above", 62000.0, nil, false},
		{"btc-price", "<64,000", "below", nil, 64000.0, false},
		{"btc-price", "64,000-66,000", "between", 64000.0, 66000.0, false},
		{"btc-price", ">82,000", "above", 82000.0, nil, false},
		{"cpi", "≤-0.3%", "below", nil, -0.3, true},
		{"cpi", "-0.2%", "exact", -0.2, -0.2, false},
		{"cpi", "3.3%", "exact", 3.3, 3.3, false},
		{"cpi", "≥4.3%", "above", 4.3, nil, true},
		{"unemployment", "≤3.8%", "below", nil, 3.8, true},
		{"payrolls", "<25k", "below", nil, 25000.0, false},
		{"payrolls", "25k to 50k", "between", 25000.0, 50000.0, false},
		{"payrolls", "150k+", "above", 150000.0, nil, true},
		{"fed-decision", "25 bps decrease", "outcome", nil, nil, false},
		{"fed-decision", "No change", "outcome", nil, nil, false},
	} {
		p, lo, hi, inc := parseLabel(c.family, c.label)
		if p != c.payoff || f(lo) != c.low || f(hi) != c.high || inc != c.inclusive {
			t.Errorf("%s %q: got %s %v–%v, want %s %v–%v", c.family, c.label, p, f(lo), f(hi), c.payoff, c.low, c.high)
		}
	}
}

func TestBookTopAndYesToken(t *testing.T) {
	var b Book
	_ = json.Unmarshal([]byte(`{"asset_id":"1","bids":[{"price":"0.01","size":"66.2"},{"price":"0.45","size":"10"},{"price":"0.46","size":"0"}],"asks":[{"price":"0.99","size":"5"},{"price":"0.48","size":"20"}]}`), &b)
	top := BookTop(b.Bids, b.Asks)
	if f(top.Bid) != 0.45 || f(top.BidSize) != 10.0 || f(top.Ask) != 0.48 || f(top.AskSize) != 20.0 {
		t.Errorf("top: bid %v×%v ask %v×%v", f(top.Bid), f(top.BidSize), f(top.Ask), f(top.AskSize))
	}
	m := PolymarketMarket{Outcomes: `["Yes", "No"]`, ClobTokenIDs: `["111", "222"]`}
	if m.YesToken() != "111" {
		t.Errorf("yes token %q", m.YesToken())
	}
}
