// Command replay writes one hour of minute-by-minute Kalshi history per event (internal/replay)
// for the site's replay (step 8): the top levels of each market's book at every minute boundary
// and the minute's trades, one gzip JSON file per event and hour.
//
//	replay -series KXBTCD -hour 2026-11-17T15 -out DIR  14-0000.jsonl.gz 15-0000.jsonl.gz
//
// Give the files in time order, starting with the previous hour's: it is read as the warm-up
// (books need a snapshot, which Kalshi sends only on a resubscribe) and nothing from it is kept.
// Output: DIR/<event>/<hour>.json.gz.
package main

import (
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"runtime/pprof"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/normalize"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

func main() {
	series := flag.String("series", "KXBTCD", "comma-separated Kalshi series to keep")
	hour := flag.String("hour", "", "the hour to record, UTC (2026-11-17T15)")
	out := flag.String("out", "replay", "output directory")
	levels := flag.Int("levels", 10, "book levels kept per side")
	memprofile := flag.String("memprofile", "", "write a heap profile here at the end (debugging)")
	warmup := flag.Duration("warmup", 20*time.Minute, "how much of the time before the hour to read")
	flag.Parse()
	start, err := time.Parse("2006-01-02T15", *hour)
	if err != nil || flag.NArg() == 0 {
		log.Fatal("usage: replay -series KXBTCD -hour 2026-11-17T15 -out DIR FILE.jsonl.gz...")
	}
	var prefixes []string
	for _, s := range strings.Split(*series, ",") {
		prefixes = append(prefixes, strings.TrimSpace(s)+"-")
	}
	n, err := normalize.New("kalshi")
	if err != nil {
		log.Fatal(err)
	}
	b := replay.New(prefixes, start.UnixNano(), start.Add(time.Hour).UnixNano(), *levels)
	// Kalshi resubscribes every ~10–12 minutes, each time with fresh books, so the last 20
	// minutes of the previous hour give every book a snapshot. Earlier records are skipped
	// unparsed, which saves most of the warm-up's cost.
	from := start.Add(-*warmup).UnixNano()
	for _, path := range flag.Args() {
		info, err := rawlog.ReadFile(path, func(r rawlog.Record) error {
			if r.RecvNs < from {
				return nil
			}
			for _, m := range n.Handle(r) {
				b.Handle(m)
			}
			return nil
		})
		if err != nil {
			log.Fatalf("%s: %v", path, err)
		}
		// The reader holds a whole compressed hour in memory (up to ~650 MB in US hours): hand it
		// back before the next file, so two are never held at once.
		debug.FreeOSMemory()
		if info.Truncated || info.Corrupt > 0 {
			log.Printf("%s: cut off by a crash (truncated %v, damaged stretches %d); complete records kept", path, info.Truncated, info.Corrupt)
		}
	}
	b.Finish()
	if *memprofile != "" {
		f, err := os.Create(*memprofile)
		if err != nil {
			log.Fatal(err)
		}
		pprof.WriteHeapProfile(f)
		f.Close()
	}

	events := map[string]map[string]*replay.Market{}
	for id, m := range b.Out {
		ev := replay.Event(id)
		if events[ev] == nil {
			events[ev] = map[string]*replay.Market{}
		}
		events[ev][id] = m
	}
	var bytes int64
	for ev, markets := range events {
		path := filepath.Join(*out, ev, start.Format("2006-01-02T15")+".json.gz")
		size, err := write(path, map[string]any{"event": ev, "hour": start.Format(time.RFC3339), "markets": markets})
		if err != nil {
			log.Fatal(err)
		}
		bytes += size
	}
	fmt.Printf("%s: %d events, %d markets, %.1f MB; gaps by reason %v\n", start.Format("2006-01-02T15"), len(events), len(b.Out), float64(bytes)/1e6, b.Gaps)
	stats, _ := json.Marshal(n.Stats())
	fmt.Printf("normalizer: %s\n", stats)
}

// write saves v as gzip JSON, through a temporary file so a reader never sees half a file.
func write(path string, v any) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return 0, err
	}
	defer os.Remove(f.Name())
	z := gzip.NewWriter(f)
	if err := json.NewEncoder(z).Encode(v); err != nil {
		return 0, err
	}
	if err := z.Close(); err != nil {
		return 0, err
	}
	st, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	return st.Size(), os.Rename(f.Name(), path)
}
