// Command rawcat writes the records of raw log files to stdout as JSONL, one per line, the same
// bytes the recorder wrote. Unlike `gzip -dc` it reads past a crash: a file cut off mid-write
// (a run killed before closing it) yields every complete record instead of an error. The nightly
// archive uses it to recompress hourly files with zstd.
//
//	rawcat kalshi/2026-11-12/17-1207.jsonl.gz | zstd -19 -o 17-1207.jsonl.zst
package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: rawcat FILE.jsonl.gz...")
	}
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	for _, path := range os.Args[1:] {
		info, err := rawlog.ReadFile(path, func(r rawlog.Record) error {
			line, err := json.Marshal(r)
			if err != nil {
				return err
			}
			out.Write(line)
			return out.WriteByte('\n')
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
}
