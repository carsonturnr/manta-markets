package tap

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // America/New_York without relying on the VM's zoneinfo

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

const (
	polymarketAPI  = "https://gamma-api.polymarket.com"
	polymarketCLOB = "https://clob.polymarket.com"
	// Books per POST /books request: undocumented limit, so keep requests modest.
	polymarketBooksPerCall = 50
)

// polymarketFamily is one kind of Polymarket event comparable to a Kalshi series. Either `dated`
// is a URL slug with %s for a New York date, or the open events tagged `listTag` are listed and
// only slugs matching `slug` are kept (economics slugs end in a random suffix, so they can't be
// spelled out). Either way, an event must also carry every tag in `tags`. `id` names the family
// in the data-quality report (cmd/status).
type polymarketFamily struct {
	id      string
	dated   string
	listTag string
	slug    *regexp.Regexp
	tags    []string
}

// polymarketFamilies is the explicit allow-list, never a free search, so nothing else can be
// recorded by accident (the tags alone are too broad: "inflation" includes egg prices).
//   - Bitcoin and Ethereum "above ___ on <date>?" (like KXBTCD, KXETHD) and "price on <date>?"
//     (ranges, like KXBTC, KXETH). They settle on the Binance 1-minute candle close at noon New
//     York time (docs/decisions.md).
//   - Fed decision per meeting (KXFEDDECISION), US CPI (KXCPI, KXCPIYOY), unemployment (KXU3)
//     and payrolls (KXPAYROLLS). The Fed pattern leaves out "fed-decisions-…" parlays; the
//     unemployment one leaves out Canada's.
var polymarketFamilies = []polymarketFamily{
	{id: "btc-above", dated: "bitcoin-above-on-%s", tags: []string{"bitcoin", "crypto"}},
	{id: "btc-price", dated: "bitcoin-price-on-%s", tags: []string{"bitcoin", "crypto"}},
	{id: "eth-above", dated: "ethereum-above-on-%s", tags: []string{"ethereum", "crypto"}},
	{id: "eth-price", dated: "ethereum-price-on-%s", tags: []string{"ethereum", "crypto"}},
	{id: "fed-decision", listTag: "fed-rates", slug: regexp.MustCompile(`^fed-decision-in-[a-z]+(-[0-9]+)?$`), tags: []string{"fomc"}},
	{id: "cpi", listTag: "us-cpi", slug: regexp.MustCompile(`^[a-z]+-inflation-us-(annual|monthly)$`), tags: []string{"us-cpi"}},
	{id: "unemployment", listTag: "jobs-report", slug: regexp.MustCompile(`^[a-z]+-unemployment-rate-[0-9]{4}$`), tags: []string{"jobs-report"}},
	{id: "payrolls", listTag: "jobs-report", slug: regexp.MustCompile(`^how-many-jobs-added-in-[a-z]+-[0-9]{4}$`), tags: []string{"nonfarm-payroll"}},
}

// PolymarketFamily returns the id of the allow-listed family an event slug belongs to, or "".
func PolymarketFamily(slug string) string {
	for _, f := range polymarketFamilies {
		dated := f.dated != "" && strings.HasPrefix(slug, strings.TrimSuffix(f.dated, "%s"))
		if dated || f.slug != nil && f.slug.MatchString(slug) {
			return f.id
		}
	}
	return ""
}

// Polymarket records polymarketFamilies (dated ones for today and the next days, New York dates): each
// discovery records the raw event JSON (stream "events"), and every cfg.PolymarketPoll the full
// order book of each contract's "Yes" outcome (stream "books", one raw response per request).
// The "No" book is the same book mirrored (a Yes bid at p is a No ask at 1 − p).
//
// Polled, not streamed: the market WebSocket sent about 730 book updates a second (5 GB/day,
// measured 2026-11-13) against 22 trades in 3 minutes. Polymarket is a read-only comparison
// line, never traded, so a full book every 10 seconds is plenty. No account, no orders.
func Polymarket(ctx context.Context, w *rawlog.Writer, cfg Config) error {
	var tokens []string
	refresh := func() error {
		found, err := polymarketDiscover(ctx, w, time.Now(), cfg.PolymarketDays)
		if err != nil {
			if we, ok := err.(writeErr); ok {
				return we.error
			}
			log.Printf("polymarket discover: %v", err)
			return w.Status("polymarket", "discover_error", err.Error())
		}
		if !slices.Equal(found, tokens) {
			if err := w.Status("polymarket", "contracts", fmt.Sprintf("%d contracts (was %d)", len(found), len(tokens))); err != nil {
				return err
			}
			tokens = found
		}
		return nil
	}

	if err := refresh(); err != nil {
		return err
	}
	discover := time.NewTicker(cfg.Discover)
	defer discover.Stop()
	poll := time.NewTicker(cfg.PolymarketPoll)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-discover.C:
			if err := refresh(); err != nil {
				return err
			}
		case <-poll.C:
			for i := 0; i < len(tokens); i += polymarketBooksPerCall {
				err := polymarketBooks(ctx, w, tokens[i:min(i+polymarketBooksPerCall, len(tokens))])
				if we, ok := err.(writeErr); ok {
					return we.error
				}
				if err != nil { // a failed poll is a missing 10 seconds, logged as a gap marker
					log.Printf("polymarket books: %v", err)
					if err := w.Status("polymarket", "poll_error", err.Error()); err != nil {
						return err
					}
				}
			}
		}
	}
}

// polymarketBooks fetches the order books of `tokens` in one request and records the raw response.
func polymarketBooks(ctx context.Context, w *rawlog.Writer, tokens []string) error {
	body := make([]map[string]string, len(tokens))
	for i, t := range tokens {
		body[i] = map[string]string{"token_id": t}
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, polymarketCLOB+"/books", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("POST /books: %s", resp.Status)
	}
	if err := w.Write("polymarket", "books", raw); err != nil {
		return writeErr{err}
	}
	return nil
}

type polymarketEvent struct {
	Slug   string `json:"slug"`
	Closed bool   `json:"closed"`
	Tags   []struct {
		Slug string `json:"slug"`
	} `json:"tags"`
	Markets []struct {
		Closed       bool   `json:"closed"`
		Outcomes     string `json:"outcomes"`     // a JSON array encoded as a string: ["Yes","No"]
		ClobTokenIDs string `json:"clobTokenIds"` // the matching token ids, encoded the same way
	} `json:"markets"`
}

// polymarketDiscover records each allow-listed event (polymarketFamilies; dated ones for the next
// `days` New York dates) and returns the "Yes" token id of each of their open markets, sorted. A
// missing event (not listed yet) is normal; an event that fails polymarketAllowed is recorded as a
// status and skipped.
func polymarketDiscover(ctx context.Context, w *rawlog.Writer, now time.Time, days int) ([]string, error) {
	var tokens []string
	for _, f := range polymarketFamilies {
		slugs, err := f.slugs(ctx, now, days)
		if err != nil {
			return nil, err
		}
		got, err := polymarketRecordEvents(ctx, w, f, slugs)
		if err != nil {
			return nil, err
		}
		tokens = append(tokens, got...)
	}
	slices.Sort(tokens)
	return slices.Compact(tokens), nil
}

// slugs returns the family's event slugs: one per date for a dated family, otherwise the open
// events listed under its tag whose slug matches.
func (f polymarketFamily) slugs(ctx context.Context, now time.Time, days int) ([]string, error) {
	if f.dated != "" {
		return polymarketSlugs(f.dated, now, days), nil
	}
	var listed []struct {
		Slug string `json:"slug"`
	}
	q := url.Values{"tag_slug": {f.listTag}, "closed": {"false"}, "limit": {"200"}}
	if _, err := getJSON(ctx, polymarketAPI+"/events?"+q.Encode(), &listed); err != nil {
		return nil, fmt.Errorf("events tagged %s: %w", f.listTag, err)
	}
	var slugs []string
	for _, e := range listed {
		if f.slug.MatchString(e.Slug) {
			slugs = append(slugs, e.Slug)
		}
	}
	return slugs, nil
}

// polymarketRecordEvents fetches and records each event by slug (so only allow-listed events are
// written) and returns the "Yes" token ids of the allowed ones' open markets.
func polymarketRecordEvents(ctx context.Context, w *rawlog.Writer, f polymarketFamily, slugs []string) ([]string, error) {
	var tokens []string
	for _, slug := range slugs {
		raw, err := getJSON(ctx, polymarketAPI+"/events?slug="+url.QueryEscape(slug), nil)
		if err != nil {
			return nil, err
		}
		var events []polymarketEvent
		if err := json.Unmarshal(raw, &events); err != nil {
			return nil, fmt.Errorf("event %s: %w", slug, err)
		}
		if len(events) == 0 {
			continue
		}
		if err := w.Write("polymarket", "events", raw); err != nil {
			return nil, writeErr{err}
		}
		for _, e := range events {
			if ok, why := polymarketAllowed(e, f.tags); !ok {
				if err := w.Status("polymarket", "rejected", e.Slug+": "+why); err != nil {
					return nil, writeErr{err}
				}
				continue
			}
			for _, m := range e.Markets {
				var outcomes, ids []string
				if m.Closed || json.Unmarshal([]byte(m.Outcomes), &outcomes) != nil ||
					json.Unmarshal([]byte(m.ClobTokenIDs), &ids) != nil || len(ids) != len(outcomes) {
					continue
				}
				if i := slices.Index(outcomes, "Yes"); i >= 0 {
					tokens = append(tokens, ids[i])
				}
			}
		}
	}
	return tokens, nil
}

// polymarketSlugs fills `pattern` with `days` New York dates starting today, e.g.
// "bitcoin-above-on-november-14-2026". New York, because the contracts are named after the date
// of their noon-ET close.
func polymarketSlugs(pattern string, now time.Time, days int) []string {
	ny, _ := time.LoadLocation("America/New_York")
	var slugs []string
	for d := range days {
		day := now.In(ny).AddDate(0, 0, d)
		date := fmt.Sprintf("%s-%d-%d", strings.ToLower(day.Month().String()), day.Day(), day.Year())
		slugs = append(slugs, fmt.Sprintf(pattern, date))
	}
	return slugs
}

// polymarketAllowed is a second guard after the slug: the event must carry every tag in `want`,
// and nothing sports-related (no sports markets, ever).
func polymarketAllowed(e polymarketEvent, want []string) (bool, string) {
	tags := map[string]bool{}
	for _, t := range e.Tags {
		tags[t.Slug] = true
	}
	for t := range tags {
		if strings.Contains(t, "sport") {
			return false, "tagged " + t
		}
	}
	for _, t := range want {
		if !tags[t] {
			return false, "not tagged " + t
		}
	}
	return true, ""
}
