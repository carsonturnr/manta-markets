// Command status shows what has been recorded and for how long (Milestone 1 demo): per venue,
// the first and last record, hours covered, record count, coverage, and every gap.
//
//	go run ./cmd/status -in ../data/raw
//
// A gap is any stretch longer than -gap with no data from a venue, or any stretch that contains a
// recorder start or a disconnect: the gap runs from the last data record before it to the first
// one after. Coverage is the share of time between the first and last record that is not in a
// gap.
//
// Each finished hourly file is summarized once into <in>/index.jsonl, so status stays fast over
// weeks of data, and hours already moved to the archive (infra/deploy/archive.sh) still count.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// fileSummary is one hourly file's contribution, enough to stitch gaps across files.
type fileSummary struct {
	Path        string     `json:"path"` // relative to -in: <venue>/<date>/<HH>.jsonl.gz
	Venue       string     `json:"venue"`
	Records     int64      `json:"records"`
	FirstData   int64      `json:"first_data"`   // ns; 0 if the file has no data records
	LastData    int64      `json:"last_data"`    // ns
	MarkerFirst bool       `json:"marker_first"` // a start/disconnect before the first data record
	Gaps        [][2]int64 `json:"gaps"`         // gaps inside the file, [from, to] ns
}

func isMarker(r rawlog.Record) bool {
	if r.Stream != "status" {
		return false
	}
	var s struct{ State string }
	_ = json.Unmarshal(r.Msg, &s)
	return s.State == "start" || s.State == "disconnected"
}

func summarize(in, rel string, gap time.Duration) (fileSummary, bool, error) {
	fs := fileSummary{Path: rel, Venue: strings.SplitN(rel, string(filepath.Separator), 2)[0]}
	marker := false
	info, err := rawlog.ReadFile(filepath.Join(in, rel), func(r rawlog.Record) error {
		fs.Records++
		if isMarker(r) {
			marker = true
			return nil
		}
		if r.Stream != "ws" {
			return nil
		}
		switch {
		case fs.FirstData == 0:
			fs.FirstData, fs.MarkerFirst = r.RecvNs, marker
		case marker || r.RecvNs-fs.LastData > gap.Nanoseconds():
			fs.Gaps = append(fs.Gaps, [2]int64{fs.LastData, r.RecvNs})
		}
		fs.LastData, marker = r.RecvNs, false
		return nil
	})
	if info.Corrupt > 0 {
		log.Printf("%s: skipped %d damaged stretch(es) (a crash mid-write); later data recovered", rel, info.Corrupt)
	}
	return fs, info.Truncated, err
}

type venueReport struct {
	first, last, records int64
	gaps                 [][2]int64
}

func main() {
	in := flag.String("in", "data/raw", "recorder output directory")
	gap := flag.Duration("gap", 30*time.Second, "a stretch longer than this with no data counts as a gap")
	showGaps := flag.Int("show-gaps", 10, "list at most this many of the longest gaps per venue")
	flag.Parse()

	indexPath := filepath.Join(*in, "index.jsonl")
	indexed := map[string]fileSummary{}
	if f, err := os.Open(indexPath); err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<26)
		for sc.Scan() {
			var s fileSummary
			if json.Unmarshal(sc.Bytes(), &s) == nil {
				indexed[s.Path] = s
			}
		}
		f.Close()
	}

	files, err := rawlog.Files(*in)
	if err != nil {
		log.Fatal(err)
	}
	idx, err := os.OpenFile(indexPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	defer idx.Close()
	currentHour := time.Now().UTC().Format("2006-01-02/15")
	for _, f := range files {
		rel, _ := filepath.Rel(*in, f)
		if _, ok := indexed[rel]; ok {
			continue
		}
		s, truncated, err := summarize(*in, rel, *gap)
		if err != nil {
			log.Fatalf("%s: %v", rel, err)
		}
		indexed[rel] = s
		// Cache finished hours only: the current hour's files are still growing.
		if !truncated && !strings.Contains(rel, currentHour) {
			b, _ := json.Marshal(s)
			fmt.Fprintln(idx, string(b))
		}
	}

	// Stitch files per venue in time order.
	paths := make([]string, 0, len(indexed))
	for p := range indexed {
		paths = append(paths, p)
	}
	sort.Slice(paths, func(i, j int) bool { return rawlog.OrderKey(paths[i]) < rawlog.OrderKey(paths[j]) })
	reports := map[string]*venueReport{}
	var venues []string
	for _, p := range paths {
		s := indexed[p]
		vr := reports[s.Venue]
		if vr == nil {
			vr = &venueReport{}
			reports[s.Venue] = vr
			venues = append(venues, s.Venue)
		}
		vr.records += s.Records
		if s.FirstData == 0 {
			continue
		}
		if vr.first == 0 {
			vr.first = s.FirstData
		} else if s.MarkerFirst || s.FirstData-vr.last > gap.Nanoseconds() {
			vr.gaps = append(vr.gaps, [2]int64{vr.last, s.FirstData})
		}
		vr.gaps = append(vr.gaps, s.Gaps...)
		vr.last = s.LastData
	}

	fmt.Printf("Recorded data in %s (gap = no data for > %s, or a restart or disconnect)\n\n", *in, *gap)
	fmt.Printf("%-9s %-19s %-19s %8s %12s %6s %9s\n", "venue", "first (UTC)", "last (UTC)", "hours", "records", "gaps", "coverage")
	for _, v := range venues {
		r := reports[v]
		if r.first == 0 {
			fmt.Printf("%-9s no data\n", v)
			continue
		}
		span := r.last - r.first
		var lost int64
		for _, g := range r.gaps {
			lost += g[1] - g[0]
		}
		cov := 100.0
		if span > 0 {
			cov = 100 * float64(span-lost) / float64(span)
		}
		fmt.Printf("%-9s %-19s %-19s %8.2f %12d %6d %8.3f%%\n", v, ts(r.first), ts(r.last),
			float64(span)/3.6e12, r.records, len(r.gaps), cov)
	}
	for _, v := range venues {
		g := reports[v].gaps
		if len(g) == 0 {
			continue
		}
		sort.Slice(g, func(i, j int) bool { return g[i][1]-g[i][0] > g[j][1]-g[j][0] })
		fmt.Printf("\n%s: longest gaps\n", v)
		for _, x := range g[:min(*showGaps, len(g))] {
			fmt.Printf("  %s → %s  %s\n", ts(x[0]), ts(x[1]), time.Duration(x[1]-x[0]).Round(time.Second))
		}
	}
}

func ts(ns int64) string { return time.Unix(0, ns).UTC().Format("2006-01-02 15:04:05") }
