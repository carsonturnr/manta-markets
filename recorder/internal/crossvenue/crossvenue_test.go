package crossvenue

import (
	"testing"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/contracts"
)

func f(v float64) *float64 { return &v }

var dec10 = time.Date(2026, 12, 10, 13, 29, 0, 0, time.UTC)

func kalshiAbove(series, event string, x float64, bid, ask float64) contracts.Contract {
	return contracts.Contract{Venue: "kalshi", ID: event + "-T", Family: series, Event: event,
		Payoff: "above", Low: f(x), Close: dec10, Bid: f(bid), Ask: f(ask), BidSize: f(100), AskSize: f(100)}
}

// pm builds a Polymarket bucket the way contracts.FromPolymarket parses its label.
func pm(family, event, payoff string, low, high *float64, inclusive bool, bid, ask float64) contracts.Contract {
	return contracts.Contract{Venue: "polymarket", ID: event + payoff, Family: family, Event: event,
		Payoff: payoff, Low: low, High: high, Inclusive: inclusive, Close: dec10.Add(15 * time.Hour),
		Bid: f(bid), Ask: f(ask), BidSize: f(50), AskSize: f(20)}
}

// November CPI, monthly: Polymarket's buckets ≤-0.3%, -0.2% … 0.5%, ≥0.6% (2026-11-16 labels).
func cpiBuckets() []contracts.Contract {
	ev := "november-inflation-us-monthly"
	out := []contracts.Contract{pm("cpi", ev, "below", nil, f(-0.3), true, 0.01, 0.02)}
	for v := -0.2; v < 0.55; v += 0.1 {
		x := float64(int(v*10+0.5*sign(v))) / 10
		b := pm("cpi", ev, "exact", f(x), f(x), false, 0.05, 0.06)
		b.ID = ev + b.Payoff + string(rune('a'+int(x*10+3)))
		out = append(out, b)
	}
	return append(out, pm("cpi", ev, "above", f(0.6), nil, true, 0.02, 0.03))
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func TestBundleCPI(t *testing.T) {
	all := append(cpiBuckets(), kalshiAbove("KXCPI", "KXCPI-26NOV", 0.2, 0.4, 0.42))
	ps := Pairs(all)
	if len(ps) != 1 {
		t.Fatalf("%d pairs, want 1: %+v", len(ps), ps)
	}
	p := ps[0]
	// Above 0.2%: the buckets 0.3, 0.4, 0.5 and ≥0.6.
	if p.Kind != "bundle" || len(p.Polymarket.IDs) != 4 {
		t.Fatalf("kind %s, %d buckets", p.Kind, len(p.Polymarket.IDs))
	}
	if *p.Polymarket.Ask != 0.06*3+0.03 || *p.Polymarket.Bid != 0.05*3+0.02 || *p.Polymarket.AskSize != 20 {
		t.Errorf("bundle bid %v ask %v size %v", *p.Polymarket.Bid, *p.Polymarket.Ask, *p.Polymarket.AskSize)
	}
	if p.Topic != "CPI one-month change, Nov 2026" || p.Question != "CPI one-month change above 0.2%" {
		t.Errorf("%q / %q", p.Topic, p.Question)
	}
}

// Kalshi "above -0.3%" is every bucket but "≤-0.3%".
func TestBundleLowestThreshold(t *testing.T) {
	ps := Pairs(append(cpiBuckets(), kalshiAbove("KXCPI", "KXCPI-26NOV", -0.3, 0.9, 0.95)))
	if len(ps) != 1 || len(ps[0].Polymarket.IDs) != 9 {
		t.Fatalf("%+v", ps)
	}
}

// Unemployment: Polymarket's "≤3.8%" holds 3.7% and 3.8%, so Kalshi's "above 3.7%" has no
// equivalent; "above 3.8%" does.
func TestBundleAcrossBucketLeftOut(t *testing.T) {
	ev := "november-unemployment-rate-2026"
	all := []contracts.Contract{
		pm("unemployment", ev, "below", nil, f(3.8), true, 0.1, 0.11),
		pm("unemployment", ev, "exact", f(3.9), f(3.9), false, 0.2, 0.21),
		pm("unemployment", ev, "above", f(4.0), nil, true, 0.6, 0.62),
		kalshiAbove("KXU3", "KXU3-26NOV", 3.7, 0.9, 0.92),
		kalshiAbove("KXU3", "KXU3-26NOV", 3.8, 0.8, 0.82),
	}
	all[4].ID = "KXU3-26NOV-T3.8"
	ps := Pairs(all)
	if len(ps) != 1 || ps[0].Kalshi.IDs[0] != "KXU3-26NOV-T3.8" || len(ps[0].Polymarket.IDs) != 2 {
		t.Fatalf("%+v", ps)
	}
}

// Payrolls: Kalshi's "above 100,000" against Polymarket's [100k, 125k) and 150k+ is equivalent
// except at exactly 100,000; "above 90,000" falls inside [75k, 100k) and has no equivalent.
func TestBundlePayrollsEdge(t *testing.T) {
	ev := "how-many-jobs-added-in-november-2026"
	all := []contracts.Contract{
		pm("payrolls", ev, "below", nil, f(75000), false, 0.3, 0.31),
		pm("payrolls", ev, "between", f(75000), f(100000), false, 0.3, 0.31),
		pm("payrolls", ev, "between", f(100000), f(125000), false, 0.2, 0.21),
		pm("payrolls", ev, "above", f(125000), nil, true, 0.1, 0.11),
		kalshiAbove("KXPAYROLLS", "KXPAYROLLS-26NOV", 100000, 0.3, 0.32),
		kalshiAbove("KXPAYROLLS", "KXPAYROLLS-26NOV", 90000, 0.4, 0.42),
	}
	all[1].ID, all[2].ID = "b75", "b100"
	ps := Pairs(all)
	if len(ps) != 1 || ps[0].Kind != "near" || len(ps[0].Polymarket.IDs) != 2 || ps[0].Note == "" {
		t.Fatalf("%+v", ps)
	}
	if ps[0].Question != "Payrolls change above 100,000 jobs" {
		t.Errorf("%q", ps[0].Question)
	}
}

func TestFed(t *testing.T) {
	close := time.Date(2026, 12, 9, 18, 59, 0, 0, time.UTC)
	k := contracts.Contract{Venue: "kalshi", ID: "KXFEDDECISION-26DEC-H0", Family: "KXFEDDECISION",
		Event: "KXFEDDECISION-26DEC", Label: "Fed maintains rate", Payoff: "outcome", Close: close}
	p := contracts.Contract{Venue: "polymarket", ID: "0xabc", Family: "fed-decision",
		Event: "fed-decision-in-december-20260729232808632", Label: "No change", Payoff: "outcome",
		Close: close.Add(10 * time.Hour)}
	far := p
	far.Event, far.ID, far.Close = "fed-decision-in-january-x", "0xdef", close.AddDate(0, 1, 0)
	ps := Pairs([]contracts.Contract{k, p, far})
	if len(ps) != 1 || ps[0].Polymarket.IDs[0] != "0xabc" || ps[0].Kind != "same" ||
		ps[0].Topic != "Fed decision, Dec 2026 meeting" {
		t.Fatalf("%+v", ps)
	}
}

// Kalshi "above $61,999.99" at 17:00 UTC is Polymarket's "higher than $62,000" at noon ET; a
// different hour or strike doesn't pair.
func TestCrypto(t *testing.T) {
	noon := time.Date(2026, 11, 17, 17, 0, 0, 0, time.UTC)
	k := func(id string, x float64, at time.Time) contracts.Contract {
		return contracts.Contract{Venue: "kalshi", ID: id, Family: "KXBTCD", Event: "KXBTCD-" + at.Format("15"),
			Payoff: "above", Low: f(x), Close: at}
	}
	p := contracts.Contract{Venue: "polymarket", ID: "0x62", Family: "btc-above",
		Event: "bitcoin-above-on-november-17-2026", Payoff: "above", Low: f(62000), Close: noon}
	ps := Pairs([]contracts.Contract{p, k("K62", 61999.99, noon), k("K625", 62499.99, noon),
		k("K62late", 61999.99, noon.Add(time.Hour))})
	if len(ps) != 1 || ps[0].Kalshi.IDs[0] != "K62" || ps[0].Kind != "near" {
		t.Fatalf("%+v", ps)
	}
}

// For one-decimal data a bucket "≥4.6%" includes 4.6% itself, a likely outcome: Kalshi's "above
// 4.6%" has no equivalent.
func TestBundleOneDecimalEdgeLeftOut(t *testing.T) {
	ev := "november-unemployment-rate-2026"
	all := []contracts.Contract{
		pm("unemployment", ev, "below", nil, f(4.5), true, 0.9, 0.91),
		pm("unemployment", ev, "above", f(4.6), nil, true, 0.05, 0.06),
		kalshiAbove("KXU3", "KXU3-26NOV", 4.6, 0.01, 0.02),
	}
	if ps := Pairs(all); len(ps) != 0 {
		t.Fatalf("%+v", ps)
	}
}
