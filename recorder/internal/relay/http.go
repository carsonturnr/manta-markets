package relay

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
)

const (
	MaxClients = 100 // open streams at once, to bound the relay's cost on the recorder's VM
	MaxTickers = 50  // markets per stream
)

// A Kalshi market ticker (KXBTCD-26NOV1717-T73749.99).
var tickerRe = regexp.MustCompile(`^[A-Z0-9][A-Z0-9.\-]{0,99}$`)

// Handler serves, read-only, to whoever sends "Authorization: Bearer <token>" (only the site's
// server knows it):
//
//	GET /stream?tickers=A,B   Server-Sent Events: one "data: <Update JSON>" per changed market,
//	                          each market's current state first, then at most one per `every`
//	GET /health               {"records":…,"dropped":…,"slow":…,"markets":…,"clients":…}
func (h *Hub) Handler(token string) http.Handler {
	slots := make(chan struct{}, MaxClients)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch r.URL.Path {
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"records": h.Records.Load(),
				"dropped": h.Dropped.Load(), "slow": h.Slow.Load(), "markets": h.Markets.Load(),
				"clients": h.Clients.Load()})
		case "/stream":
			tickers := strings.Split(r.URL.Query().Get("tickers"), ",")
			if len(tickers) > MaxTickers {
				http.Error(w, fmt.Sprintf("at most %d tickers", MaxTickers), http.StatusBadRequest)
				return
			}
			for _, t := range tickers {
				if !tickerRe.MatchString(t) {
					http.Error(w, "bad ticker", http.StatusBadRequest)
					return
				}
			}
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			default:
				http.Error(w, "too many streams", http.StatusServiceUnavailable)
				return
			}
			slices.Sort(tickers)
			h.stream(w, r, slices.Compact(tickers))
		default:
			http.NotFound(w, r)
		}
	})
}

func (h *Hub) stream(w http.ResponseWriter, r *http.Request, tickers []string) {
	c := &client{tickers: tickers, ch: make(chan []byte, outBuffer)}
	select {
	case h.join <- c:
	case <-h.done:
		http.Error(w, "relay stopped", http.StatusServiceUnavailable)
		return
	}
	defer func() {
		select {
		case h.leave <- c:
		case <-h.done:
		}
	}()
	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	// write gives up on a client that can't take a push within 10 s, so a stuck connection
	// never holds its goroutine (the server has no overall write timeout: streams are long).
	write := func(s string) bool {
		rc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := w.Write([]byte(s)); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
	if !write(": relay\n\n") {
		return
	}
	// A comment every 15 s keeps proxies from closing a quiet stream.
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-c.ch:
			if !ok { // dropped as too slow: the client reconnects and starts from current state
				return
			}
			if !write("data: " + string(msg) + "\n\n") {
				return
			}
		case <-ping.C:
			if !write(": ping\n\n") {
				return
			}
		}
	}
}
