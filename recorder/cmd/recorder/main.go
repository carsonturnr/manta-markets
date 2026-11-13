// Command recorder records raw market data to hourly gzip JSONL files (internal/rawlog): Kalshi's
// Bitcoin contracts, Deribit's Bitcoin options and index, Bitcoin spot from Coinbase and Kraken,
// Polymarket's daily Bitcoin contracts, and Binance BTC/USDT. It runs for weeks under systemd: a write failure exits non-zero so it restarts, and
// every start and disconnect is a status record, so gaps show up in `status`.
//
//	go run ./cmd/recorder -out ../data/raw
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/tap"
)

var venues = []string{"kalshi", "deribit", "coinbase", "kraken", "polymarket", "binance"}

func main() {
	out := flag.String("out", "data/raw", "output directory")
	series := flag.String("kalshi-series", "KXBTCD,KXBTC,KXBTC15M", "Kalshi series to record, comma-separated (category must be allowed)")
	discover := flag.Duration("discover", 10*time.Minute, "market and instrument re-discovery interval")
	kalshiPoll := flag.Duration("kalshi-poll", 10*time.Second, "Kalshi orderbook poll interval per market (no API key)")
	kalshiRestSnap := flag.Duration("kalshi-rest-snapshot", 5*time.Minute, "Kalshi REST orderbook snapshot interval (WebSocket mode)")
	deribitDays := flag.Int("deribit-days", 2, "record Deribit option tickers expiring within this many days")
	deribitBand := flag.Float64("deribit-strike-band", 0.15, "…and with a strike within this fraction of the index")
	polymarketDays := flag.Int("polymarket-days", 3, "record Polymarket's daily Bitcoin contracts for this many New York dates")
	polymarketPoll := flag.Duration("polymarket-poll", 10*time.Second, "Polymarket order book poll interval")
	minFreeGB := flag.Uint64("min-free-gb", 5, "stop cleanly (exit 0) when the output disk has less free space")
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

func freeBytes(path string) (uint64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return st.Bavail * uint64(st.Bsize), nil
}
