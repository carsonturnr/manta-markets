// Package crossvenue pairs Kalshi and Polymarket contracts on the same event (docs/product.md,
// step 4). Pairs come only from fixed rules per family, never from matching text, and each says
// how equivalent its two sides are:
//
//   - same:   the identical outcome on the same source (the Fed's decision)
//   - bundle: Kalshi's "above x" against the sum of Polymarket's buckets above x (CPI,
//     unemployment). Buying every one of those buckets pays $1 exactly when Kalshi's contract
//     does, so the bundle's ask is the sum of the buckets' asks and its bid the sum of their bids.
//   - near:   equivalent except in a stated case (Note): payrolls exactly on a boundary, or Bitcoin
//     and Ether settled on different indexes at the same time.
//
// A Kalshi threshold that falls inside a Polymarket bucket (Kalshi's "above 3.7%" against
// Polymarket's "≤3.8%") has no equivalent and is left out.
package crossvenue

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/contracts"
)

type Side struct {
	IDs     []string `json:"ids"` // one contract, or a bundle's buckets
	Bid     *float64 `json:"bid"` // "yes"; a bundle's is the sum, nil if any bucket has none
	Ask     *float64 `json:"ask"`
	BidSize *float64 `json:"bid_size"` // a bundle's is its smallest bucket's
	AskSize *float64 `json:"ask_size"`
}

type Pair struct {
	Topic      string    `json:"topic"`    // "Fed decision, Dec 2026 meeting"
	Question   string    `json:"question"` // "CPI one-month change above 0.2%"
	Kind       string    `json:"kind"`     // same | bundle | near
	Note       string    `json:"note"`     // what differs, for "near"
	Close      time.Time `json:"close"`    // Kalshi's close
	Order      int       `json:"order"`    // position within the topic
	Kalshi     Side      `json:"kalshi"`
	Polymarket Side      `json:"polymarket"`
}

// Pairs finds every pair among the open contracts of both venues.
func Pairs(all []contracts.Contract) []Pair {
	k, p := index(all, "kalshi"), index(all, "polymarket")
	var out []Pair
	out = append(out, fed(k["KXFEDDECISION"], p["fed-decision"])...)
	for _, b := range bundles {
		out = append(out, bundle(b, k[b.series], p[b.family])...)
	}
	out = append(out, crypto("Bitcoin", k["KXBTCD"], p["btc-above"])...)
	out = append(out, crypto("Ether", k["KXETHD"], p["eth-above"])...)
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].Close.Equal(out[j].Close) {
			return out[i].Close.Before(out[j].Close)
		}
		if out[i].Topic != out[j].Topic {
			return out[i].Topic < out[j].Topic
		}
		return out[i].Order < out[j].Order
	})
	return out
}

// index groups one venue's contracts by family, then by event.
func index(all []contracts.Contract, venue string) map[string]map[string][]contracts.Contract {
	out := map[string]map[string][]contracts.Contract{}
	for _, c := range all {
		if c.Venue != venue {
			continue
		}
		if out[c.Family] == nil {
			out[c.Family] = map[string][]contracts.Contract{}
		}
		out[c.Family][c.Event] = append(out[c.Family][c.Event], c)
	}
	return out
}

// sameEvent finds the Polymarket event closing within 3 days of the Kalshi one: both venues list
// one event per Fed meeting or data release, closing around the release.
func sameEvent(k []contracts.Contract, p map[string][]contracts.Contract, ok func(string) bool) []contracts.Contract {
	for slug, cs := range p {
		if ok != nil && !ok(slug) {
			continue
		}
		if d := k[0].Close.Sub(cs[0].Close); math.Abs(d.Hours()) <= 72 {
			return cs
		}
	}
	return nil
}

func single(c contracts.Contract) Side {
	return Side{IDs: []string{c.ID}, Bid: c.Bid, Ask: c.Ask, BidSize: c.BidSize, AskSize: c.AskSize}
}

// month reads "Nov 2026" from a Kalshi event ticker ending in YYMON: KXCPI-26NOV.
func month(event string) string {
	_, s, _ := strings.Cut(event, "-")
	if t, err := time.Parse("06Jan", s[:min(len(s), 5)]); err == nil {
		return t.Format("Jan 2006")
	}
	return s
}

// ---- Fed decision: the same five outcomes on both venues ----------------------------------

var fedOutcomes = []struct{ kalshi, poly, question string }{
	{"Cut >25bps", "50+ bps decrease", "Cut by more than 25 bps"},
	{"Cut 25bps", "25 bps decrease", "Cut by 25 bps"},
	{"Fed maintains rate", "No change", "No change"},
	{"Hike 25bps", "25 bps increase", "Hike by 25 bps"},
	{"Hike >25bps", "50+ bps increase", "Hike by more than 25 bps"},
}

func fed(k, p map[string][]contracts.Contract) []Pair {
	var out []Pair
	for event, kc := range k {
		pc := sameEvent(kc, p, nil)
		if pc == nil {
			continue
		}
		for i, o := range fedOutcomes {
			kk, kok := byLabel(kc, o.kalshi)
			pp, pok := byLabel(pc, o.poly)
			if !kok || !pok {
				continue
			}
			out = append(out, Pair{
				Topic: "Fed decision, " + month(event) + " meeting", Question: o.question, Kind: "same",
				Close: kk.Close, Order: i, Kalshi: single(kk), Polymarket: single(pp),
			})
		}
	}
	return out
}

func byLabel(cs []contracts.Contract, label string) (contracts.Contract, bool) {
	for _, c := range cs {
		if c.Label == label {
			return c, true
		}
	}
	return contracts.Contract{}, false
}

// ---- Bundles: Kalshi's "above x" against Polymarket's buckets above x ---------------------

type bundleRule struct {
	series, family string
	slug           func(string) bool // which of the family's events (CPI: monthly or annual)
	subject        string
	unit           string // "%" or "jobs"
	// A bucket starting exactly at Kalshi's threshold differs from it only at that one value.
	// For payrolls (reported to the thousand) that is rare: the pair is "near". For one-decimal
	// percentages it is a whole likely outcome (4.6% itself): no equivalent.
	edgeIsNear bool
}

var bundles = []bundleRule{
	{"KXCPI", "cpi", func(s string) bool { return strings.HasSuffix(s, "-monthly") }, "CPI one-month change", "%", false},
	{"KXCPIYOY", "cpi", func(s string) bool { return strings.HasSuffix(s, "-annual") }, "CPI 12-month change", "%", false},
	{"KXU3", "unemployment", nil, "Unemployment rate", "%", false},
	{"KXPAYROLLS", "payrolls", nil, "Payrolls change", "jobs", true},
}

const eps = 1e-9

// side says where a Polymarket bucket lies against Kalshi's "value > x": above (every value in
// it is > x), below (every value ≤ x), edge (all above except a value exactly x), or across.
// Polymarket's ranges include their lower bound ("a value exactly on a boundary goes to the
// higher range"), so a range [l, h) holds values from l up to, not including, h.
func side(b contracts.Contract, x float64) string {
	switch b.Payoff {
	case "exact":
		if *b.Low > x+eps {
			return "above"
		}
		return "below"
	case "below": // < h, or ≤ h if inclusive: all ≤ x when h ≤ x either way
		if *b.High <= x+eps {
			return "below"
		}
	case "between": // [l, h)
		switch {
		case *b.Low > x+eps:
			return "above"
		case math.Abs(*b.Low-x) < eps:
			return "edge"
		case *b.High <= x+eps:
			return "below"
		}
	case "above": // > l, or ≥ l if inclusive
		switch {
		case *b.Low > x+eps, math.Abs(*b.Low-x) < eps && !b.Inclusive:
			return "above"
		case math.Abs(*b.Low-x) < eps:
			return "edge"
		}
	}
	return "across"
}

func bundle(r bundleRule, k, p map[string][]contracts.Contract) []Pair {
	var out []Pair
	for event, kc := range k {
		pc := sameEvent(kc, p, r.slug)
		if pc == nil {
			continue
		}
		for _, c := range kc {
			if c.Payoff != "above" || c.Low == nil || c.Inclusive {
				continue
			}
			x := *c.Low
			var in []contracts.Contract
			kind, ok := "bundle", true
			for _, b := range pc {
				if b.Payoff == "outcome" || (b.Low == nil && b.High == nil) {
					ok = false
					break
				}
				switch side(b, x) {
				case "above":
					in = append(in, b)
				case "edge":
					in, kind = append(in, b), "near"
					ok = ok && r.edgeIsNear
				case "across":
					ok = false
				}
			}
			if !ok || len(in) == 0 || len(in) == len(pc) {
				continue // no equivalent, or every bucket (then the bet is certain on Polymarket)
			}
			p := Pair{
				Topic:    fmt.Sprintf("%s, %s", r.subject, month(event)),
				Question: fmt.Sprintf("%s above %s", r.subject, value(x, r.unit)),
				Kind:     kind, Close: c.Close, Order: int(math.Round(x * 10)),
				Kalshi: single(c), Polymarket: sum(in),
			}
			if kind == "near" {
				p.Note = fmt.Sprintf("Differs only if the value is exactly %s: Kalshi's \"above\" "+
					"excludes it, Polymarket puts it in the higher range.", value(x, r.unit))
			}
			out = append(out, p)
		}
	}
	return out
}

func value(x float64, unit string) string {
	if unit == "%" {
		return fmt.Sprintf("%.1f%%", x)
	}
	return commas(int64(math.Round(x))) + " jobs"
}

func commas(n int64) string {
	s := fmt.Sprint(n)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	if neg {
		return "-" + s
	}
	return s
}

// sum is a bundle's side: buying every bucket costs the sum of their asks, selling every bucket
// raises the sum of their bids, and only as many bundles as the thinnest bucket allows.
func sum(in []contracts.Contract) Side {
	s := Side{}
	var bid, ask float64
	bidOK, askOK := true, true
	var bidSize, askSize = math.Inf(1), math.Inf(1)
	for _, b := range in {
		s.IDs = append(s.IDs, b.ID)
		if b.Bid == nil || b.BidSize == nil {
			bidOK = false
		} else {
			bid += *b.Bid
			bidSize = min(bidSize, *b.BidSize)
		}
		if b.Ask == nil || b.AskSize == nil {
			askOK = false
		} else {
			ask += *b.Ask
			askSize = min(askSize, *b.AskSize)
		}
	}
	if bidOK {
		s.Bid, s.BidSize = ptr(round4(bid)), ptr(bidSize)
	}
	if askOK {
		s.Ask, s.AskSize = ptr(round4(ask)), ptr(askSize)
	}
	return s
}

func ptr(f float64) *float64 { return &f }

func round4(f float64) float64 { return math.Round(f*1e4) / 1e4 }

// ---- Crypto: the same strike at the same moment, settled on different indexes ---------------

// crypto pairs Kalshi's hourly "above" contracts with Polymarket's noon-ET ones when both close at
// the same instant (Kalshi lists hourly events about an hour ahead, so this is the hour before
// noon New York time). Kalshi's strikes sit a cent below a round number ("above $61,999.99");
// Polymarket's are round and strict ("higher than $62,000"): the same bet to the cent.
func crypto(name string, k, p map[string][]contracts.Contract) []Pair {
	var out []Pair
	for _, pc := range p {
		for _, kc := range k {
			if !kc[0].Close.Equal(pc[0].Close) {
				continue
			}
			for _, pp := range pc {
				for _, kk := range kc {
					if kk.Low == nil || pp.Low == nil || kk.Inclusive ||
						math.Abs(*kk.Low-(*pp.Low-0.01)) > 0.001 {
						continue
					}
					out = append(out, Pair{
						Topic: fmt.Sprintf("%s at noon New York time, %s", name,
							kk.Close.Format("Jan 2")),
						Question: fmt.Sprintf("%s above $%s", name, commas(int64(*pp.Low))),
						Kind:     "near",
						Note: "Same moment, different index: Kalshi settles on a 60-second average " +
							"of CF Benchmarks' real-time index (in dollars), Polymarket on one Binance " +
							"1-minute close (in USDT, a dollar stablecoin).",
						Close: kk.Close, Order: int(*pp.Low), Kalshi: single(kk), Polymarket: single(pp),
					})
				}
			}
		}
	}
	return out
}
