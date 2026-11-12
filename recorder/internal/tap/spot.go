package tap

import (
	"context"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// Kalshi's Bitcoin contracts settle on the CF Benchmarks Real-Time Index (BRTI), averaged over
// the last 60 seconds. The BRTI is not a free public feed, so we record two of the exchanges it
// is built from as a stand-in, and later measure how far the stand-in sits from Kalshi's
// published settlement values.

// Coinbase records the BTC-USD ticker (every trade, with best bid and ask) from Coinbase
// Exchange's public feed, plus its once-a-second heartbeat.
func Coinbase(ctx context.Context, w *rawlog.Writer) error {
	return wsSession{
		venue: "coinbase",
		url:   "wss://ws-feed.exchange.coinbase.com",
		subscribe: [][]byte{
			[]byte(`{"type":"subscribe","product_ids":["BTC-USD"],"channels":["ticker","heartbeat"]}`),
		},
	}.run(ctx, w, "BTC-USD")
}

// Kraken records the BTC/USD ticker from Kraken's public v2 WebSocket, updated on every change of
// the best bid or ask ("bbo"; the default updates only on trades).
func Kraken(ctx context.Context, w *rawlog.Writer) error {
	return wsSession{
		venue:     "kraken",
		url:       "wss://ws.kraken.com/v2",
		subscribe: [][]byte{[]byte(`{"method":"subscribe","params":{"channel":"ticker","symbol":["BTC/USD"],"event_trigger":"bbo"}}`)},
		ping:      []byte(`{"method":"ping"}`),
		pingEvery: 30 * time.Second,
	}.run(ctx, w, "BTC/USD")
}
