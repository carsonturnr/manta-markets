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

// Binance records BTC/USDT from Binance's public WebSocket: the 1-minute candles (Polymarket's
// Bitcoin contracts settle on the close of one of them) and the ticker once a second (best bid
// and ask, last price). Not the best-bid/ask stream: it updates many times a second, hundreds of
// MB a day for nothing the pricing uses. Binance closes connections after 24 hours; the session
// reconnects and the moment shows up as a status record.
//
// From data-stream.binance.vision, Binance's public market-data-only host, not stream.binance.com:
// the main site refuses US users (HTTP 451, seen from a development Mac), and Manta runs from the US.
func Binance(ctx context.Context, w *rawlog.Writer) error {
	return wsSession{
		venue: "binance",
		url:   "wss://data-stream.binance.vision/ws",
		subscribe: [][]byte{
			[]byte(`{"method":"SUBSCRIBE","params":["btcusdt@kline_1m","btcusdt@ticker"],"id":1}`),
		},
	}.run(ctx, w, "BTCUSDT")
}
