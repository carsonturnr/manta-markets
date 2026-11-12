package tap

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// kalshiAPI is a variable so tests can point it at a fake server.
var kalshiAPI = "https://api.elections.kalshi.com/trade-api/v2"

const (
	kalshiWS     = "wss://api.elections.kalshi.com/trade-api/ws/v2"
	kalshiWSPath = "/trade-api/ws/v2"
	// Kalshi's basic tier allows 20 reads/s; stay well under it.
	kalshiReqInterval = 125 * time.Millisecond
)

// AllowedCategories are the only Kalshi series categories Manta records. CLAUDE.md: Bitcoin and
// other financial contracts only, never sports, not even for testing.
var AllowedCategories = map[string]bool{"Crypto": true, "Financials": true, "Economics": true}

// CheckSeries confirms every configured series exists and has an allowed category. The
// recorder refuses to start otherwise, so a sports series can't be recorded by a typo.
func CheckSeries(ctx context.Context, tickers []string) error {
	if len(tickers) == 0 {
		return fmt.Errorf("no Kalshi series configured")
	}
	for _, t := range tickers {
		cat, err := seriesCategory(ctx, t)
		if err != nil {
			return fmt.Errorf("kalshi series %s: %w", t, err)
		}
		if !AllowedCategories[cat] {
			return fmt.Errorf("kalshi series %s has category %q: not allowed", t, cat)
		}
	}
	return nil
}

func seriesCategory(ctx context.Context, ticker string) (string, error) {
	var resp struct {
		Series struct {
			Category string `json:"category"`
		} `json:"series"`
	}
	if _, err := getJSON(ctx, kalshiAPI+"/series/"+url.PathEscape(ticker), &resp); err != nil {
		return "", err
	}
	return resp.Series.Category, nil
}

// kalshiDiscover returns the open market tickers of the configured series, and records the raw
// market list (stream "markets"). A series whose category is no longer allowed is skipped.
func kalshiDiscover(ctx context.Context, w *rawlog.Writer, cfg Config, throttle <-chan time.Time) ([]string, error) {
	var tickers []string
	for _, series := range cfg.KalshiSeries {
		<-throttle
		cat, err := seriesCategory(ctx, series)
		if err != nil {
			return nil, err
		}
		if !AllowedCategories[cat] {
			log.Printf("kalshi: skipping series %s, category %q", series, cat)
			continue
		}
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
			raw, err := getJSON(ctx, kalshiAPI+"/markets?"+q.Encode(), &resp)
			if err != nil {
				return nil, err
			}
			if err := w.Write("kalshi", "markets", raw); err != nil {
				return nil, writeErr{err}
			}
			for _, m := range resp.Markets {
				var mm struct {
					Ticker string `json:"ticker"`
				}
				if json.Unmarshal(m, &mm) == nil && mm.Ticker != "" {
					tickers = append(tickers, mm.Ticker)
				}
			}
			if resp.Cursor == "" || len(resp.Markets) == 0 {
				break
			}
			cursor = resp.Cursor
		}
	}
	slices.Sort(tickers)
	return slices.Compact(tickers), nil
}

// Kalshi records books over the authenticated WebSocket when cfg.KalshiAuth is set, and by
// polling each market's REST orderbook otherwise.
func Kalshi(ctx context.Context, w *rawlog.Writer, cfg Config) error {
	throttle := time.NewTicker(kalshiReqInterval)
	defer throttle.Stop()
	if cfg.KalshiAuth != nil {
		return kalshiStream(ctx, w, cfg, throttle.C)
	}
	return kalshiPoll(ctx, w, cfg, throttle)
}

// kalshiStream subscribes to orderbook_delta and trade for every discovered market on one
// connection, resubscribes when the set changes, and records REST orderbook snapshots every
// cfg.KalshiRestSnap for rebuild checks. A skipped seq means a lost update: the connection
// is dropped and the reconnect delivers fresh snapshots.
func kalshiStream(ctx context.Context, w *rawlog.Writer, cfg Config, throttle <-chan time.Time) error {
	var current []string
	var cancelConn context.CancelFunc = func() {}
	errs := make(chan error, 1)
	defer func() { cancelConn() }()

	refresh := func() error {
		got, err := kalshiDiscover(ctx, w, cfg, throttle)
		if err != nil {
			if we, ok := err.(writeErr); ok {
				return we.error
			}
			log.Printf("kalshi discover: %v", err)
			return w.Status("kalshi", "discover_error", err.Error())
		}
		if slices.Equal(got, current) {
			return nil
		}
		if err := w.Status("kalshi", "resubscribe", fmt.Sprintf("%d markets (was %d)", len(got), len(current))); err != nil {
			return err
		}
		cancelConn()
		connCtx, cancel := context.WithCancel(ctx)
		cancelConn, current = cancel, got
		sub, _ := json.Marshal(map[string]any{"id": 1, "cmd": "subscribe", "params": map[string]any{
			"channels": []string{"orderbook_delta", "trade"}, "market_tickers": got}})
		s := wsSession{venue: "kalshi", url: kalshiWS, subscribe: [][]byte{sub},
			header:   func() http.Header { return cfg.KalshiAuth.headers(http.MethodGet, kalshiWSPath) },
			newCheck: kalshiSeqCheck}
		label := fmt.Sprintf("conn 0 (%d markets)", len(got))
		go func() {
			if err := s.run(connCtx, w, label); err != nil && connCtx.Err() == nil {
				errs <- err
			}
		}()
		return nil
	}

	if err := refresh(); err != nil {
		return err
	}
	discover := time.NewTicker(cfg.Discover)
	defer discover.Stop()
	snapshot := time.NewTicker(cfg.KalshiRestSnap)
	defer snapshot.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errs:
			return err
		case <-discover.C:
			if err := refresh(); err != nil {
				return err
			}
		case <-snapshot.C:
			if err := kalshiRestRound(ctx, w, current, throttle); err != nil {
				return err
			}
		}
	}
}

// kalshiSeqCheck returns a per-connection check that seq increases by one per subscription.
func kalshiSeqCheck() func([]byte) error {
	last := map[int]uint64{}
	return func(msg []byte) error {
		var m struct {
			Sid int    `json:"sid"`
			Seq uint64 `json:"seq"`
		}
		if json.Unmarshal(msg, &m) != nil || m.Seq == 0 {
			return nil
		}
		prev, ok := last[m.Sid]
		last[m.Sid] = m.Seq
		if ok && m.Seq != prev+1 {
			return fmt.Errorf("seq gap on sid %d: %d after %d", m.Sid, m.Seq, prev)
		}
		return nil
	}
}

// kalshiRestRound records one REST orderbook per market (stream "orderbook").
func kalshiRestRound(ctx context.Context, w *rawlog.Writer, tickers []string, throttle <-chan time.Time) error {
	for _, t := range tickers {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-throttle:
		}
		raw, err := getJSON(ctx, kalshiAPI+"/markets/"+url.PathEscape(t)+"/orderbook", nil)
		if err != nil {
			if e := w.Status("kalshi", "poll_error", fmt.Sprintf("%s: %v", t, err)); e != nil {
				return e
			}
			continue
		}
		msg, _ := json.Marshal(map[string]json.RawMessage{"ticker": mustJSON(t), "book": raw})
		if err := w.Write("kalshi", "orderbook", msg); err != nil {
			return err
		}
	}
	return nil
}

// kalshiPoll polls each market's REST orderbook every cfg.KalshiPoll (no API key).
func kalshiPoll(ctx context.Context, w *rawlog.Writer, cfg Config, throttle *time.Ticker) error {

	var tickers []string
	var lastDiscover time.Time
	for ctx.Err() == nil {
		if time.Since(lastDiscover) >= cfg.Discover {
			got, err := kalshiDiscover(ctx, w, cfg, throttle.C)
			switch {
			case err == nil:
				if !slices.Equal(got, tickers) {
					if e := w.Status("kalshi", "markets", fmt.Sprintf("%d markets (was %d)", len(got), len(tickers))); e != nil {
						return e
					}
				}
				tickers, lastDiscover = got, time.Now()
			default:
				if we, ok := err.(writeErr); ok {
					return we.error
				}
				log.Printf("kalshi discover: %v", err)
				if e := w.Status("kalshi", "discover_error", err.Error()); e != nil {
					return e
				}
				lastDiscover = time.Now().Add(-cfg.Discover + 30*time.Second) // retry in 30s
			}
		}
		round := time.Now()
		if err := kalshiRestRound(ctx, w, tickers, throttle.C); err != nil {
			return err
		}
		if wait := cfg.KalshiPoll - time.Since(round); wait > 0 {
			select {
			case <-ctx.Done():
			case <-time.After(wait):
			}
		}
	}
	return ctx.Err()
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
