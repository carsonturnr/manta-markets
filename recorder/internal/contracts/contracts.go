// Package contracts is the screener's contract model (docs/product.md, step 2): every Kalshi and
// Polymarket contract Manta covers, in one shape. It converts each venue's listing JSON; fetching
// is in cmd/contracts.
//
// A contract pays $1 if "yes". Its payoff says when:
//   - above:   the result is above Low (Kalshi "or above" strikes are stored as the venue gives them)
//   - below:   the result is below High
//   - between: the result is from Low to High
//   - exact:   the result, as published, equals Low (= High), e.g. Polymarket's "CPI is 3.3%"
//   - outcome: a named result, in Label (e.g. the Fed's "25 bps decrease")
//
// Inclusive says the strike itself counts for "above" or "below" (≥, ≤, "150k+", Kalshi's
// greater_or_equal), so a summary can say "at or above" instead of "above".
//
// Prices are probabilities (0.42 = 42¢). Strikes are in the underlying's unit: dollars, index
// points, percent (3.3 = 3.3%), or jobs.
package contracts

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Contract struct {
	Venue  string   `json:"venue"`  // kalshi | polymarket
	ID     string   `json:"id"`     // Kalshi ticker, Polymarket condition id
	Family string   `json:"family"` // Kalshi series, Polymarket family id (tap.PolymarketFamily)
	Event  string   `json:"event"`  // Kalshi event ticker, Polymarket event slug
	Title  string   `json:"title"`  // the venue's question
	Label  string   `json:"label"`  // the venue's short name for this contract: "$74,300 or above"
	Payoff string   `json:"payoff"` // above | below | between | exact | outcome
	Low    *float64 `json:"low"`
	High   *float64 `json:"high"`
	// The strike itself counts (≥ or ≤), for above and below.
	Inclusive bool      `json:"inclusive"`
	Close     time.Time `json:"close"` // trading stops

	Bid     *float64 `json:"bid"` // best "yes" bid; nil if none
	Ask     *float64 `json:"ask"` // best "yes" ask; nil if none
	BidSize *float64 `json:"bid_size"`
	AskSize *float64 `json:"ask_size"` // contracts (Polymarket: shares, the same thing)
	Last    *float64 `json:"last"`

	Volume24h    float64  `json:"volume_24h"`
	VolumeUnit   string   `json:"volume_unit"`   // "contracts" (Kalshi) or "usd" (Polymarket)
	OpenInterest *float64 `json:"open_interest"` // contracts; Kalshi only

	// Fees: a trade of C contracts at price P pays rate × C × P × (1 − P), for a taker (an order
	// matched at once) or a maker (a resting order, when it fills). Nil if the venue's fee type
	// isn't one this model knows. Kalshi's fee schedule (July 2026): 0.07 for takers, 0.0175 for
	// makers where the series charges them, times the series' multiplier; Polymarket: the
	// market's feeSchedule rate for takers, nothing for makers.
	FeeTaker *float64 `json:"fee_taker"`
	FeeMaker *float64 `json:"fee_maker"`
}

// KalshiFees returns the taker and maker rates for a Kalshi series' fee type and multiplier.
func KalshiFees(feeType string, multiplier float64) (taker, maker *float64) {
	switch feeType {
	case "quadratic":
		return ptr(0.07 * multiplier), ptr(0)
	case "quadratic_with_maker_fees":
		return ptr(0.07 * multiplier), ptr(0.0175 * multiplier)
	}
	return nil, nil
}

// num reads a JSON number or a number in a string (both venues use both); empty is 0.
type num float64

func (n *num) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*n = 0
		return nil
	}
	f, err := strconv.ParseFloat(s, 64)
	*n = num(f)
	return err
}

func ptr(f float64) *float64 { return &f }

// orNil is nil for a missing price level: Kalshi reports no bid as 0 and no ask as 1, both with
// size 0.
func orNil(price, size num) (*float64, *float64) {
	if size <= 0 {
		return nil, nil
	}
	return ptr(float64(price)), ptr(float64(size))
}

type kalshiMarket struct {
	Ticker       string    `json:"ticker"`
	EventTicker  string    `json:"event_ticker"`
	Title        string    `json:"title"`
	YesSubTitle  string    `json:"yes_sub_title"`
	StrikeType   string    `json:"strike_type"`
	FloorStrike  *float64  `json:"floor_strike"`
	CapStrike    *float64  `json:"cap_strike"`
	CloseTime    time.Time `json:"close_time"`
	YesBid       num       `json:"yes_bid_dollars"`
	YesAsk       num       `json:"yes_ask_dollars"`
	YesBidSize   num       `json:"yes_bid_size_fp"`
	YesAskSize   num       `json:"yes_ask_size_fp"`
	LastPrice    num       `json:"last_price_dollars"`
	Volume24h    num       `json:"volume_24h_fp"`
	OpenInterest num       `json:"open_interest_fp"`
}

// FromKalshi converts one market from Kalshi's market list. Kalshi gives the payoff directly.
func FromKalshi(series string, raw []byte) (Contract, error) {
	var m kalshiMarket
	if err := json.Unmarshal(raw, &m); err != nil {
		return Contract{}, err
	}
	c := Contract{Venue: "kalshi", ID: m.Ticker, Family: series, Event: m.EventTicker,
		Title: m.Title, Label: m.YesSubTitle, Close: m.CloseTime,
		Volume24h: float64(m.Volume24h), VolumeUnit: "contracts", OpenInterest: ptr(float64(m.OpenInterest))}
	switch m.StrikeType {
	case "greater", "greater_or_equal":
		c.Payoff, c.Low, c.Inclusive = "above", m.FloorStrike, m.StrikeType == "greater_or_equal"
	case "less", "less_or_equal":
		c.Payoff, c.High, c.Inclusive = "below", m.CapStrike, m.StrikeType == "less_or_equal"
	case "between":
		c.Payoff, c.Low, c.High = "between", m.FloorStrike, m.CapStrike
	case "custom": // the Fed decision: "Hike >25bps", "Cut 25bps", "Hold"
		c.Payoff = "outcome"
	default:
		return Contract{}, fmt.Errorf("%s: unknown strike type %q", m.Ticker, m.StrikeType)
	}
	c.Bid, c.BidSize = orNil(m.YesBid, m.YesBidSize)
	c.Ask, c.AskSize = orNil(m.YesAsk, m.YesAskSize)
	if m.LastPrice > 0 {
		c.Last = ptr(float64(m.LastPrice))
	}
	return c, nil
}

// PolymarketEvent is the part of a Polymarket event the model reads.
type PolymarketEvent struct {
	Slug    string             `json:"slug"`
	Markets []PolymarketMarket `json:"markets"`
}

type PolymarketMarket struct {
	ConditionID    string    `json:"conditionId"`
	Question       string    `json:"question"`
	GroupItemTitle string    `json:"groupItemTitle"` // the label: "62,000", "64,000-66,000", "≤3.2%", "No change"
	EndDate        time.Time `json:"endDate"`
	Closed         bool      `json:"closed"`
	Outcomes       string    `json:"outcomes"`     // a JSON array in a string: ["Yes","No"]
	ClobTokenIDs   string    `json:"clobTokenIds"` // the matching token ids, encoded the same way
	BestBid        num       `json:"bestBid"`
	BestAsk        num       `json:"bestAsk"`
	LastTradePrice num       `json:"lastTradePrice"`
	Volume24hr     num       `json:"volume24hr"`
	FeesEnabled    bool      `json:"feesEnabled"`
	FeeSchedule    *struct {
		Exponent  float64 `json:"exponent"`
		Rate      float64 `json:"rate"`
		TakerOnly bool    `json:"takerOnly"`
	} `json:"feeSchedule"`
}

// fees reads a Polymarket market's fee terms: rate × C × P × (1 − P) for takers when the
// exponent is 1 (the only form Polymarket's fee page documents), none for makers.
func (m PolymarketMarket) fees() (taker, maker *float64) {
	if !m.FeesEnabled {
		return ptr(0), ptr(0)
	}
	if f := m.FeeSchedule; f != nil && f.Exponent == 1 && f.TakerOnly {
		return ptr(f.Rate), ptr(0)
	}
	return nil, nil
}

// YesToken returns the token id of the market's "Yes" outcome, whose order book is the contract's.
func (m PolymarketMarket) YesToken() string {
	var outcomes, ids []string
	if json.Unmarshal([]byte(m.Outcomes), &outcomes) != nil ||
		json.Unmarshal([]byte(m.ClobTokenIDs), &ids) != nil || len(ids) != len(outcomes) {
		return ""
	}
	for i, o := range outcomes {
		if o == "Yes" {
			return ids[i]
		}
	}
	return ""
}

// Top is the best level on each side of a "Yes" order book.
type Top struct {
	Bid, BidSize, Ask, AskSize *float64
}

// FromPolymarket converts one market of an allow-listed event. `top` is its "Yes" book from the
// CLOB; without one, the gamma listing's best bid and ask are used, with no sizes.
func FromPolymarket(family string, e PolymarketEvent, m PolymarketMarket, top *Top) Contract {
	c := Contract{Venue: "polymarket", ID: m.ConditionID, Family: family, Event: e.Slug,
		Title: m.Question, Label: m.GroupItemTitle, Close: m.EndDate,
		Volume24h: float64(m.Volume24hr), VolumeUnit: "usd"}
	c.Payoff, c.Low, c.High, c.Inclusive = parseLabel(family, m.GroupItemTitle)
	c.FeeTaker, c.FeeMaker = m.fees()
	if top != nil {
		c.Bid, c.BidSize, c.Ask, c.AskSize = top.Bid, top.BidSize, top.Ask, top.AskSize
	} else {
		if m.BestBid > 0 {
			c.Bid = ptr(float64(m.BestBid))
		}
		if m.BestAsk > 0 && m.BestAsk < 1 {
			c.Ask = ptr(float64(m.BestAsk))
		}
	}
	if m.LastTradePrice > 0 {
		c.Last = ptr(float64(m.LastTradePrice))
	}
	return c
}

var (
	// A number as Polymarket writes it: "64,000", "-0.3%", "25k".
	numRe   = `-?[0-9][0-9,]*(?:\.[0-9]+)?%?k?`
	rangeRe = regexp.MustCompile(`^(` + numRe + `)\s*(?:-|to)\s*(` + numRe + `)$`)
	belowRe = regexp.MustCompile(`^(?:<|≤)\s*(` + numRe + `)$`)
	aboveRe = regexp.MustCompile(`^(?:>|≥)\s*(` + numRe + `)$|^(` + numRe + `)\+$`)
	exactRe = regexp.MustCompile(`^(` + numRe + `)$`)
)

func parseNum(s string) float64 {
	mult := 1.0
	if strings.HasSuffix(s, "k") {
		mult, s = 1000, strings.TrimSuffix(s, "k")
	}
	s = strings.TrimSuffix(strings.ReplaceAll(s, ",", ""), "%")
	f, _ := strconv.ParseFloat(s, 64)
	return math.Round(f*mult*1e6) / 1e6
}

// parseLabel reads a Polymarket label into a payoff. In the "above" families a bare number is
// the strike ("Bitcoin above $62,000"); elsewhere it is an exact result ("CPI is 3.3%").
// Anything else (the Fed's "25 bps decrease") is a named outcome.
func parseLabel(family, label string) (payoff string, low, high *float64, inclusive bool) {
	l := strings.TrimSpace(label)
	if m := rangeRe.FindStringSubmatch(l); m != nil {
		return "between", ptr(parseNum(m[1])), ptr(parseNum(m[2])), false
	}
	if m := belowRe.FindStringSubmatch(l); m != nil {
		return "below", nil, ptr(parseNum(m[1])), strings.HasPrefix(l, "≤")
	}
	if m := aboveRe.FindStringSubmatch(l); m != nil {
		return "above", ptr(parseNum(m[1] + m[2])), nil, !strings.HasPrefix(l, ">")
	}
	if m := exactRe.FindStringSubmatch(l); m != nil {
		v := parseNum(m[1])
		if strings.HasSuffix(family, "-above") { // "higher than the price in the title"
			return "above", ptr(v), nil, false
		}
		return "exact", ptr(v), ptr(v), false
	}
	return "outcome", nil, nil, false
}

// BookTop reads the best bid and ask from one CLOB book ({"bids": [{"price", "size"}], ...}).
// The levels' order isn't relied on: the best bid is the highest, the best ask the lowest.
func BookTop(bids, asks []struct{ Price, Size num }) Top {
	var t Top
	for _, l := range bids {
		if l.Size > 0 && (t.Bid == nil || float64(l.Price) > *t.Bid) {
			t.Bid, t.BidSize = ptr(float64(l.Price)), ptr(float64(l.Size))
		}
	}
	for _, l := range asks {
		if l.Size > 0 && (t.Ask == nil || float64(l.Price) < *t.Ask) {
			t.Ask, t.AskSize = ptr(float64(l.Price)), ptr(float64(l.Size))
		}
	}
	return t
}

// Book is one CLOB order book as POST /books returns it.
type Book struct {
	AssetID string                      `json:"asset_id"`
	Bids    []struct{ Price, Size num } `json:"bids"`
	Asks    []struct{ Price, Size num } `json:"asks"`
}
