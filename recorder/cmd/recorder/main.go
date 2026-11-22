// Command recorder records raw market data to hourly gzip JSONL files (internal/rawlog): Kalshi's
// crypto, economics and financials series (kalshiSeries), Deribit's Bitcoin and Ether options and
// indices, Bitcoin spot from Coinbase and Kraken, Polymarket's comparable events, and Binance BTC/USDT. It runs for weeks under systemd: a write failure exits non-zero so it restarts, and
// every start and disconnect is a status record, so gaps show up in `status`.
//
//	go run ./cmd/recorder -out ../data/raw
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/relay"
	"github.com/carsonturnr/manta-markets/recorder/internal/tap"
)

// The default Kalshi series are the allow-list in tap.KalshiSeries, each checked at startup to be in
// an allowed category. Never a sports series.
var kalshiSeries = strings.Join(tap.KalshiSeries, ",")

var venues = []string{"kalshi", "deribit", "coinbase", "kraken", "polymarket", "binance"}

func main() {
	out := flag.String("out", "data/raw", "output directory")
	series := flag.String("kalshi-series", kalshiSeries, "Kalshi series to record, comma-separated (category must be allowed)")
	discover := flag.Duration("discover", 10*time.Minute, "market and instrument re-discovery interval")
	kalshiPoll := flag.Duration("kalshi-poll", 10*time.Second, "Kalshi orderbook poll interval per market (no API key)")
	kalshiRestSnap := flag.Duration("kalshi-rest-snapshot", 5*time.Minute, "Kalshi REST orderbook snapshot interval (WebSocket mode)")
	deribitDays := flag.Int("deribit-days", 2, "record Deribit option tickers expiring within this many days")
	deribitBand := flag.Float64("deribit-strike-band", 0.15, "…and with a strike within this fraction of the index")
	polymarketDays := flag.Int("polymarket-days", 3, "record Polymarket's daily Bitcoin contracts for this many New York dates")
	polymarketPoll := flag.Duration("polymarket-poll", 10*time.Second, "Polymarket order book poll interval")
	minFreeGB := flag.Uint64("min-free-gb", 5, "stop cleanly (exit 0) when the output disk has less free space")
	relayAddr := flag.String("relay-addr", "", "serve live Kalshi books and trades here over TLS (internal/relay; needs RELAY_TOKEN); off when empty")
	relayCert := flag.String("relay-cert", "/etc/manta/relay.crt", "the relay's TLS certificate (the site trusts exactly this one)")
	relayKey := flag.String("relay-key", "/etc/manta/relay.key", "the relay's TLS private key")
	relayEvery := flag.Duration("relay-every", 250*time.Millisecond, "push each changed market at most this often")
	flag.Parse()

	cfg := tap.Config{
		KalshiSeries:      strings.Split(*series, ","),
		Discover:          *discover,
		KalshiPoll:        *kalshiPoll,
		KalshiRestSnap:    *kalshiRestSnap,
		DeribitDays:       *deribitDays,
		DeribitStrikeBand: *deribitBand,
		PolymarketDays:    *polymarketDays,
		PolymarketPoll:    *polymarketPoll,
	}
	if id, path := os.Getenv("KALSHI_API_KEY_ID"), os.Getenv("KALSHI_PRIVATE_KEY_PATH"); id != "" && path != "" {
		auth, err := tap.LoadKalshiAuth(id, path)
		if err != nil {
			log.Fatal(err)
		}
		cfg.KalshiAuth = auth
		log.Print("kalshi: WebSocket mode")
	} else {
		log.Print("kalshi: REST polling (KALSHI_API_KEY_ID / KALSHI_PRIVATE_KEY_PATH not set)")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// Refuse to start on a series that doesn't exist or isn't an allowed category (no sports).
	check, cancel := context.WithTimeout(ctx, 30*time.Second)
	if err := tap.CheckSeries(check, cfg.KalshiSeries); err != nil {
		log.Fatal(err)
	}
	cancel()

	w := rawlog.New(*out, nil)
	defer func() {
		if err := w.Close(); err != nil {
			log.Printf("close: %v", err)
		}
	}()
	if *relayAddr != "" {
		startRelay(ctx, w, *relayAddr, *relayEvery, *relayCert, *relayKey)
	}
	for _, v := range venues {
		if err := w.Status(v, "start", "recorder "+strings.Join(os.Args[1:], " ")); err != nil {
			log.Fatal(err)
		}
	}

	errs := make(chan error, len(venues))
	go func() { errs <- tap.Kalshi(ctx, w, cfg) }()
	go func() { errs <- tap.Deribit(ctx, w, cfg) }()
	go func() { errs <- tap.Coinbase(ctx, w) }()
	go func() { errs <- tap.Kraken(ctx, w) }()
	go func() { errs <- tap.Polymarket(ctx, w, cfg) }()
	go func() { errs <- tap.Binance(ctx, w) }()

	flush := time.NewTicker(time.Second)
	defer flush.Stop()
	diskCheck := time.NewTicker(time.Minute)
	defer diskCheck.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Print("shutting down")
			return
		case err := <-errs:
			if ctx.Err() != nil { // a normal shutdown: the feeds return the canceled context
				log.Print("shutting down")
				return
			}
			// Only a write failure (or a bug) gets here: exit non-zero so systemd restarts us and
			// the gap shows up in the status records.
			stop()
			_ = w.Close()
			log.Fatalf("fatal: %v", err)
		case <-diskCheck.C:
			if free, err := freeBytes(*out); err == nil && free < *minFreeGB<<30 {
				// Exit 0 so systemd does not restart into a full disk.
				for _, v := range venues {
					_ = w.Status(v, "disk_low", fmt.Sprintf("%.1f GB free < %d GB; stopping", float64(free)/(1<<30), *minFreeGB))
				}
				stop()
				_ = w.Close()
				log.Printf("disk low (%d bytes free); stopping", free)
				os.Exit(0)
			}
		case <-flush.C:
			if err := w.Flush(); err != nil {
				stop()
				log.Fatalf("flush: %v", err)
			}
		}
	}
}

// startRelay feeds every record the recorder writes to the relay and serves it over TLS, so the
// token and the data never cross the internet in the clear. A relay problem (no token, no
// certificate, a failed listener) is logged and leaves the relay off: it never stops the recording.
func startRelay(ctx context.Context, w *rawlog.Writer, addr string, every time.Duration, certFile, keyFile string) {
	token := os.Getenv("RELAY_TOKEN")
	if len(token) < 32 {
		log.Print("relay off: RELAY_TOKEN must be set (32+ characters)")
		return
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		log.Printf("relay off: %v", err)
		return
	}
	hub := relay.New(every)
	w.OnWrite = hub.Write
	go hub.Run(ctx.Done())
	// No WriteTimeout: streams stay open; each push has its own 10 s deadline (relay.Handler).
	srv := &http.Server{Addr: addr, Handler: hub.Handler(token), ReadHeaderTimeout: 10 * time.Second,
		MaxHeaderBytes: 8 << 10,
		TLSConfig:      &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}}
	go func() { log.Printf("relay: %v", srv.ListenAndServeTLS("", "")) }()
	go func() { <-ctx.Done(); srv.Close() }()
	log.Printf("relay: serving on %s (TLS)", addr)
}

func freeBytes(path string) (uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return st.Bavail * uint64(st.Bsize), nil
}
