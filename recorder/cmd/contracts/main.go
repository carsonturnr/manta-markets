// Command contracts lists every open contract Manta covers, in one shape (internal/contracts),
// for the site's screener (docs/product.md, step 2):
//
//	go run ./cmd/contracts -out contracts.json
//
// Kalshi: every open market of each allow-listed series (tap.KalshiSeries), from its market list.
// Polymarket: every market of each allow-listed event (tap.PolymarketOpenEvents), with the best
// bid and ask from the CLOB order books. On the VM, manta-contracts.service runs it every minute
// and stores the result (pricing: manta-contracts).
//
// A series or event that fails is logged and left out; the run fails only if nothing was listed.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/contracts"
	"github.com/carsonturnr/manta-markets/recorder/internal/tap"
)

type output struct {
	Generated time.Time            `json:"generated"`
	Contracts []contracts.Contract `json:"contracts"`
	Errors    []string             `json:"errors"` // what was left out, and why
}

func main() {
	out := flag.String("out", "contracts.json", "write the contracts here (JSON)")
	days := flag.Int("polymarket-days", 3, "Polymarket's dated families for this many New York dates")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	res := output{Generated: time.Now().UTC(), Contracts: []contracts.Contract{}, Errors: []string{}}
	fail := func(what string, err error) {
		log.Printf("%s: %v", what, err)
		res.Errors = append(res.Errors, what+": "+err.Error())
	}

	// Kalshi: about 50 requests at 4 a second, half the recorder's pace: the two share Kalshi's
	// rate limit, which they briefly exceeded together at 8 a second each. A failed series is
	// tried once more after a pause.
	throttle := time.NewTicker(250 * time.Millisecond)
	defer throttle.Stop()
	for _, series := range tap.KalshiSeries {
		markets, err := tap.KalshiOpenMarkets(ctx, series, throttle.C)
		if err != nil {
			time.Sleep(2 * time.Second)
			markets, err = tap.KalshiOpenMarkets(ctx, series, throttle.C)
		}
		if err != nil {
			fail("kalshi "+series, err)
			continue
		}
		for _, raw := range markets {
			c, err := contracts.FromKalshi(series, raw)
			if err != nil {
				fail("kalshi "+series, err)
				continue
			}
			res.Contracts = append(res.Contracts, c)
		}
	}

	if err := polymarket(ctx, *days, &res.Contracts); err != nil {
		fail("polymarket", err)
	}

	if len(res.Contracts) == 0 {
		log.Fatal("no contracts listed")
	}
	b, err := json.Marshal(res)
	if err != nil {
		log.Fatal(err)
	}
	// Write then rename, so a reader never sees half a file.
	if err := os.WriteFile(*out+".tmp", b, 0o644); err != nil {
		log.Fatal(err)
	}
	if err := os.Rename(*out+".tmp", *out); err != nil {
		log.Fatal(err)
	}
	log.Printf("%d contracts, %d errors", len(res.Contracts), len(res.Errors))
}

// polymarket appends every open market of the allow-listed events, priced from the CLOB books.
func polymarket(ctx context.Context, days int, all *[]contracts.Contract) error {
	now := time.Now()
	events, err := tap.PolymarketOpenEvents(ctx, now, days)
	if err != nil {
		return err
	}
	type item struct {
		family string
		event  contracts.PolymarketEvent
		market contracts.PolymarketMarket
	}
	var items []item
	var tokens []string
	for _, pe := range events {
		var e contracts.PolymarketEvent
		if err := json.Unmarshal(pe.Raw, &e); err != nil {
			return err
		}
		for _, m := range e.Markets {
			// Polymarket keeps a market open after trading ends, until it resolves: list only
			// those still trading.
			if m.Closed || !m.EndDate.After(now) {
				continue
			}
			items = append(items, item{pe.Family, e, m})
			if t := m.YesToken(); t != "" {
				tokens = append(tokens, t)
			}
		}
	}

	// The books' best levels, by token. A failed request leaves those markets on the listing's
	// prices (no sizes) rather than dropping them.
	tops := map[string]*contracts.Top{}
	for i := 0; i < len(tokens); i += tap.PolymarketBooksPerCall {
		raw, err := tap.PolymarketBooks(ctx, tokens[i:min(i+tap.PolymarketBooksPerCall, len(tokens))])
		if err != nil {
			log.Printf("polymarket books: %v", err)
			continue
		}
		var books []contracts.Book
		if err := json.Unmarshal(raw, &books); err != nil {
			log.Printf("polymarket books: %v", err)
			continue
		}
		for _, b := range books {
			top := contracts.BookTop(b.Bids, b.Asks)
			tops[b.AssetID] = &top
		}
	}
	for _, it := range items {
		*all = append(*all, contracts.FromPolymarket(it.family, it.event, it.market, tops[it.market.YesToken()]))
	}
	return nil
}
