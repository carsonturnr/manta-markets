// Package tap records raw market data to rawlog files: Kalshi's Bitcoin contracts, Deribit's
// Bitcoin options and index, Bitcoin spot from Coinbase and Kraken (a stand-in for the CF
// Benchmarks index Kalshi settles on), Polymarket's daily Bitcoin contracts, and Binance BTC/USDT
// (what Polymarket settles on). Raw venue messages are stored as received; parsing
// happens later, so a parsing bug can never lose data.
package tap

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/coder/websocket"
)

// Config selects what to record.
type Config struct {
	KalshiSeries      []string      // series tickers to record: an explicit allow-list (kalshi.go)
	Discover          time.Duration // how often to re-discover markets and instruments
	KalshiPoll        time.Duration // per-market orderbook poll interval (without KalshiAuth)
	KalshiAuth        *KalshiAuth   // set: stream books over WebSocket, poll REST only for checks
	KalshiRestSnap    time.Duration // REST orderbook snapshot interval in WebSocket mode
	DeribitDays       int           // record option tickers expiring within this many days…
	DeribitStrikeBand float64       // …with a strike within this fraction of the index (0.15 = ±15%)
	PolymarketDays    int           // record Polymarket's daily contracts for this many New York dates
	PolymarketPoll    time.Duration // order book poll interval for those contracts
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

func getJSON(ctx context.Context, url string, out any) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "series-tap/0.1")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return body, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return body, fmt.Errorf("GET %s: %w", url, err)
		}
	}
	return body, nil
}

// wsSession is one WebSocket connection's lifecycle: dial, subscribe, read until error.
type wsSession struct {
	venue     string
	url       string
	subscribe [][]byte                      // sent after every (re)connect
	ping      []byte                        // application-level ping payload
	pingEvery time.Duration                 // 0 = no ping
	header    func() http.Header            // per-dial handshake headers (auth), optional
	newCheck  func() func(msg []byte) error // per-connection check; an error reconnects, optional
}

// run keeps the session connected until ctx ends, recording every message and every
// connect/disconnect as a status record. Returns only a rawlog write error or ctx error.
func (s wsSession) run(ctx context.Context, w *rawlog.Writer, label string) error {
	backoff := time.Second
	for ctx.Err() == nil {
		connectedAt := time.Now()
		err := s.once(ctx, w, label)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var werr writeErr
		if asWriteErr(err, &werr) {
			return werr.error
		}
		if time.Since(connectedAt) > time.Minute {
			backoff = time.Second
		}
		if e := w.Status(s.venue, "disconnected", fmt.Sprintf("%s: %v; retry in %s", label, err, backoff)); e != nil {
			return e
		}
		log.Printf("%s %s: %v (retry in %s)", s.venue, label, err, backoff)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 30*time.Second)
	}
	return ctx.Err()
}

type writeErr struct{ error }

func asWriteErr(err error, out *writeErr) bool {
	we, ok := err.(writeErr)
	if ok {
		*out = we
	}
	return ok
}

func (s wsSession) once(ctx context.Context, w *rawlog.Writer, label string) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	dialCtx, dialCancel := context.WithTimeout(ctx, 20*time.Second)
	var opts *websocket.DialOptions
	if s.header != nil {
		opts = &websocket.DialOptions{HTTPHeader: s.header()}
	}
	c, _, err := websocket.Dial(dialCtx, s.url, opts)
	dialCancel()
	if err != nil {
		return err
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 26)
	for _, sub := range s.subscribe {
		if err := c.Write(ctx, websocket.MessageText, sub); err != nil {
			return err
		}
	}
	frames := make([]string, len(s.subscribe))
	for i, f := range s.subscribe {
		frames[i] = string(f)
	}
	sub, _ := json.Marshal(map[string]any{"label": label, "frames": frames})
	if err := w.Write(s.venue, "subscribe", sub); err != nil {
		return writeErr{err}
	}
	if err := w.Status(s.venue, "connected", label); err != nil {
		return writeErr{err}
	}
	var check func([]byte) error
	if s.newCheck != nil {
		check = s.newCheck()
	}
	if s.pingEvery > 0 {
		go func() {
			t := time.NewTicker(s.pingEvery)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if err := c.Write(ctx, websocket.MessageText, s.ping); err != nil {
						cancel()
						return
					}
				}
			}
		}()
	}
	for {
		// A silent socket is a dead socket: every venue here sends data or pongs well within this.
		readCtx, readCancel := context.WithTimeout(ctx, 2*time.Minute)
		_, msg, err := c.Read(readCtx)
		readCancel()
		if err != nil {
			return err
		}
		if err := w.Write(s.venue, "ws", msg); err != nil {
			return writeErr{err}
		}
		if check != nil {
			if err := check(msg); err != nil {
				return err
			}
		}
	}
}
