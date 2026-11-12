package tap

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

const (
	deribitAPI = "https://www.deribit.com/api/v2/public"
	deribitWS  = "wss://www.deribit.com/ws/api/v2"
	// Deribit accepts many channels per subscribe call, but keep requests modest.
	deribitChannelsPerCall = 100
)

// Deribit records, over Deribit's public WebSocket (no account needed):
//   - deribit_price_index.btc_usd: Deribit's BTC index, about once a second;
//   - markprice.options.btc_usd: mark price and implied volatility of every BTC option, in one
//     message per update (the volatility surface the pricing engine starts from);
//   - ticker.<option>.agg2 for options expiring within cfg.DeribitDays with a strike within
//     cfg.DeribitStrikeBand of the index (the ones that price Kalshi's hourly contracts): best bid and ask with
//     their implied volatilities, and the underlying price, once a second. (100 ms tickers were
//     2.9 GB/day for no pricing benefit on hourly contracts; the surface above is also 1/s.)
//
// The instrument list (strikes and expiries) is recorded at each discovery (stream
// "instruments"); when the near-expiry set changes, the connection resubscribes.
func Deribit(ctx context.Context, w *rawlog.Writer, cfg Config) error {
	var current []string
	var cancelConn context.CancelFunc = func() {}
	errs := make(chan error, 1)
	defer func() { cancelConn() }()

	refresh := func() error {
		names, err := deribitInstruments(ctx, w, cfg.DeribitDays, cfg.DeribitStrikeBand)
		if err != nil {
			if we, ok := err.(writeErr); ok {
				return we.error
			}
			log.Printf("deribit instruments: %v", err)
			return w.Status("deribit", "discover_error", err.Error())
		}
		if slices.Equal(names, current) {
			return nil
		}
		if err := w.Status("deribit", "resubscribe", fmt.Sprintf("%d option tickers (was %d)", len(names), len(current))); err != nil {
			return err
		}
		cancelConn()
		connCtx, cancel := context.WithCancel(ctx)
		cancelConn, current = cancel, names
		channels := []string{"deribit_price_index.btc_usd", "markprice.options.btc_usd"}
		for _, n := range names {
			channels = append(channels, "ticker."+n+".agg2")
		}
		var subs [][]byte
		for i := 0; i < len(channels); i += deribitChannelsPerCall {
			b, _ := json.Marshal(map[string]any{
				"jsonrpc": "2.0", "id": i/deribitChannelsPerCall + 1, "method": "public/subscribe",
				"params": map[string]any{"channels": channels[i:min(i+deribitChannelsPerCall, len(channels))]},
			})
			subs = append(subs, b)
		}
		s := wsSession{venue: "deribit", url: deribitWS, subscribe: subs,
			ping: []byte(`{"jsonrpc":"2.0","id":0,"method":"public/test"}`), pingEvery: 15 * time.Second}
		label := fmt.Sprintf("conn 0 (%d channels)", len(channels))
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
		}
	}
}

// deribitInstruments records the live BTC option list and returns the names of options expiring
// within `days` whose strike is within `band` (a fraction) of the current index, sorted.
func deribitInstruments(ctx context.Context, w *rawlog.Writer, days int, band float64) ([]string, error) {
	var resp struct {
		Result []deribitInstrument `json:"result"`
	}
	raw, err := getJSON(ctx, deribitAPI+"/get_instruments?currency=BTC&kind=option&expired=false", &resp)
	if err != nil {
		return nil, err
	}
	if err := w.Write("deribit", "instruments", raw); err != nil {
		return nil, writeErr{err}
	}
	var index struct {
		Result struct {
			IndexPrice float64 `json:"index_price"`
		} `json:"result"`
	}
	if _, err := getJSON(ctx, deribitAPI+"/get_index_price?index_name=btc_usd", &index); err != nil {
		return nil, err
	}
	return nearMoney(resp.Result, time.Now(), days, index.Result.IndexPrice, band), nil
}

type deribitInstrument struct {
	InstrumentName      string  `json:"instrument_name"`
	ExpirationTimestamp int64   `json:"expiration_timestamp"` // unix ms
	Strike              float64 `json:"strike"`
}

// nearMoney picks the instruments expiring within `days` of now whose strike lies within
// `band` (e.g. 0.15 = ±15%) of `index`, sorted by name.
func nearMoney(insts []deribitInstrument, now time.Time, days int, index, band float64) []string {
	limit := now.Add(time.Duration(days) * 24 * time.Hour).UnixMilli()
	var names []string
	for _, in := range insts {
		near := in.Strike >= index*(1-band) && in.Strike <= index*(1+band)
		if in.ExpirationTimestamp > now.UnixMilli() && in.ExpirationTimestamp <= limit && near {
			names = append(names, in.InstrumentName)
		}
	}
	slices.Sort(names)
	return names
}
