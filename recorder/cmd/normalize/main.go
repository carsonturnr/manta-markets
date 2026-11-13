// Command normalize runs the normalizer (internal/normalize) over raw log files of one venue and
// writes the md.v1 messages to stdout as JSONL, one {"type": ..., "msg": ...} per line: books
// (snapshots and deltas, the YES side for Kalshi), trades, and status events (gaps and resyncs,
// when a book can't be trusted). The consistency statistics go to stderr as JSON at the end.
// Milestone 4's catalog converter reads this output.
//
//	normalize -venue kalshi kalshi/2026-11-13/*.jsonl.gz > kalshi-md.jsonl
//
// Files must be given in time order (the recorder's names sort that way).
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"log"
	"os"

	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/normalize"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

func main() {
	venue := flag.String("venue", "kalshi", "venue of the files")
	flag.Parse()
	if flag.NArg() == 0 {
		log.Fatal("usage: normalize -venue VENUE FILE.jsonl.gz...")
	}
	n, err := normalize.New(*venue)
	if err != nil {
		log.Fatal(err)
	}
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	enc := json.NewEncoder(out)
	for _, path := range flag.Args() {
		info, err := rawlog.ReadFile(path, func(r rawlog.Record) error {
			for _, m := range n.Handle(r) {
				if err := enc.Encode(map[string]any{"type": kind(m), "msg": m}); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			log.Fatalf("%s: %v", path, err)
		}
		if info.Truncated || info.Corrupt > 0 {
			log.Printf("%s: cut off by a crash (truncated %v, damaged stretches %d); complete records kept", path, info.Truncated, info.Corrupt)
		}
	}
	if err := out.Flush(); err != nil {
		log.Fatal(err)
	}
	stats, _ := json.MarshalIndent(n.Stats(), "", "  ")
	os.Stderr.Write(append(stats, '\n'))
}

func kind(m md.Msg) string {
	switch m.(type) {
	case *md.Book:
		return "book"
	case *md.Trade:
		return "trade"
	case *md.Status:
		return "status"
	case *md.Ctx:
		return "ctx"
	}
	return "unknown"
}
