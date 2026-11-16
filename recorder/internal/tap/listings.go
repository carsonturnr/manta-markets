package tap

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"
)

// Listings for the screener (cmd/contracts): the same allow-lists and checks as the recorder,
// returned instead of recorded.

// PolymarketBooksPerCall is the most tokens PolymarketBooks takes in one request.
const PolymarketBooksPerCall = polymarketBooksPerCall

// KalshiSeriesTerms is a series' category and fee terms, from GET /series/{ticker}. FeeType is
// "quadratic" (takers pay), "quadratic_with_maker_fees" (makers pay too), or another type the
// fee model doesn't know.
type KalshiSeriesTerms struct {
	Category      string  `json:"category"`
	FeeType       string  `json:"fee_type"`
	FeeMultiplier float64 `json:"fee_multiplier"`
}

// KalshiOpenMarkets returns the series' terms and the raw JSON of every open market in it,
// following the page cursor. It refuses a series whose category isn't allowed (no sports).
// `throttle` paces the requests, which share Kalshi's rate limit with the recorder.
func KalshiOpenMarkets(ctx context.Context, series string, throttle <-chan time.Time) (KalshiSeriesTerms, []json.RawMessage, error) {
	<-throttle
	var info struct {
		Series KalshiSeriesTerms `json:"series"`
	}
	if _, err := getJSON(ctx, kalshiAPI+"/series/"+url.PathEscape(series), &info); err != nil {
		return KalshiSeriesTerms{}, nil, fmt.Errorf("kalshi series %s: %w", series, err)
	}
	s := info.Series
	if !AllowedCategories[s.Category] {
		return s, nil, fmt.Errorf("kalshi series %s has category %q: not allowed", series, s.Category)
	}
	var markets []json.RawMessage
	cursor := ""
	for {
		q := url.Values{"series_ticker": {series}, "status": {"open"}, "limit": {"1000"}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		var resp struct {
			Cursor  string            `json:"cursor"`
			Markets []json.RawMessage `json:"markets"`
		}
		<-throttle
		if _, err := getJSON(ctx, kalshiAPI+"/markets?"+q.Encode(), &resp); err != nil {
			return s, nil, err
		}
		markets = append(markets, resp.Markets...)
		if resp.Cursor == "" || len(resp.Markets) == 0 {
			return s, markets, nil
		}
		cursor = resp.Cursor
	}
}

// PolymarketEvent is one allow-listed Polymarket event: its family id and raw JSON.
type PolymarketEvent struct {
	Family string
	Raw    json.RawMessage
}

// PolymarketOpenEvents returns every allow-listed event (polymarketFamilies; dated ones for the
// next `days` New York dates) that passes polymarketAllowed. A missing event is normal.
func PolymarketOpenEvents(ctx context.Context, now time.Time, days int) ([]PolymarketEvent, error) {
	var out []PolymarketEvent
	for _, f := range polymarketFamilies {
		slugs, err := f.slugs(ctx, now, days)
		if err != nil {
			return nil, err
		}
		for _, slug := range slugs {
			var raws []json.RawMessage
			if _, err := getJSON(ctx, polymarketAPI+"/events?slug="+url.QueryEscape(slug), &raws); err != nil {
				return nil, err
			}
			for _, raw := range raws {
				var e polymarketEvent
				if err := json.Unmarshal(raw, &e); err != nil {
					return nil, fmt.Errorf("event %s: %w", slug, err)
				}
				if ok, _ := polymarketAllowed(e, f.tags); ok && !e.Closed {
					out = append(out, PolymarketEvent{Family: f.id, Raw: raw})
				}
			}
		}
	}
	return out, nil
}
