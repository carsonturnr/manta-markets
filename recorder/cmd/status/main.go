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
//
// With -json FILE it writes the same figures, plus records per hour and per contract family, as
// JSON for the site's data-quality page (infra/deploy/manta-quality.service), and prints nothing.
package main

import (
	"bufio"
	"bytes"
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
	"github.com/carsonturnr/manta-markets/recorder/internal/tap"
)

// summaryVersion is bumped when fileSummary gains fields: older index entries of files still on
// disk are summarized again (archived files keep their old entry, without the new fields).
const summaryVersion = 2

// fileSummary is one hourly file's contribution, enough to stitch gaps across files.
type fileSummary struct {
	Path        string     `json:"path"` // relative to -in: <venue>/<date>/<HH>.jsonl.gz
	Venue       string     `json:"venue"`
	Records     int64      `json:"records"`
	FirstData   int64      `json:"first_data"`   // ns; 0 if the file has no data records
	LastData    int64      `json:"last_data"`    // ns
	MarkerFirst bool       `json:"marker_first"` // a start/disconnect before the first data record
	Gaps        [][2]int64 `json:"gaps"`         // gaps inside the file, [from, to] ns
	V           int        `json:"v"`
	// Data per contract family: a Kalshi series, a Deribit currency, a Polymarket family id
	// (tap.PolymarketFamily), or "spot" for the single-pair venues.
	Families map[string]*famStat `json:"families,omitempty"`
}

type famStat struct {
	Records   int64 `json:"records"`   // data messages (Polymarket: books)
	Contracts int   `json:"contracts"` // distinct contracts with data in the file
}

// dataStreams carry market data; the others are listings (markets, instruments, events),
// subscriptions and status markers. "orderbook" is Kalshi polled over REST, "books" Polymarket.
var dataStreams = map[string]bool{"ws": true, "orderbook": true, "books": true}

func isMarker(r rawlog.Record) bool {
	if r.Stream != "status" {
		return false
	}
	var s struct{ State string }
	_ = json.Unmarshal(r.Msg, &s)
	return s.State == "start" || s.State == "disconnected"
}

// quoted returns the string value after the first `"key":"` in msg, or "". A byte search, not a
// JSON parse: status reads hundreds of millions of messages.
func quoted(msg []byte, key string) string {
	i := bytes.Index(msg, []byte(`"`+key+`":"`))
	if i < 0 {
		return ""
	}
	rest := msg[i+len(key)+4:]
	j := bytes.IndexByte(rest, '"')
	if j < 0 {
		return ""
	}
	return string(rest[:j])
}

// familyOf returns a data record's contract family and contract, or "" if it names neither.
// Polymarket is handled separately: a book names its market, and the market's family comes from
// the events in the same file.
func familyOf(r rawlog.Record) (family, contract string) {
	switch r.Venue {
	case "kalshi":
		t := quoted(r.Msg, "market_ticker") // WebSocket
		if t == "" {
			t = quoted(r.Msg, "ticker") // REST orderbook: {"ticker": ..., "book": ...}
		}
		series, _, _ := strings.Cut(t, "-")
		return series, t
	case "deribit":
		ch := quoted(r.Msg, "channel")
		if inst, ok := strings.CutPrefix(ch, "ticker."); ok { // ticker.ETH-17NOV26-1960-C.agg2
			inst = strings.TrimSuffix(inst, ".agg2")
			cur, _, _ := strings.Cut(inst, "-")
			return cur, inst
		}
		// markprice.options.eth_usd, deribit_price_index.btc_usd: a currency, no single contract.
		cur := strings.TrimSuffix(ch[strings.LastIndexByte(ch, '.')+1:], "_usd")
		return strings.ToUpper(cur), ""
	default: // coinbase, kraken, binance: one pair each
		return "spot", r.Venue
	}
}

func summarize(in, rel string, gap time.Duration) (fileSummary, bool, error) {
	fs := fileSummary{Path: rel, Venue: strings.SplitN(rel, string(filepath.Separator), 2)[0],
		V: summaryVersion, Families: map[string]*famStat{}}
	contracts := map[string]map[string]bool{} // family → contracts seen
	pmBooks := map[string]int64{}             // Polymarket condition id → books
	pmFamily := map[string]string{}           // Polymarket condition id → family id
	count := func(family, contract string, n int64) {
		if family == "" {
			return
		}
		if fs.Families[family] == nil {
			fs.Families[family], contracts[family] = &famStat{}, map[string]bool{}
		}
		fs.Families[family].Records += n
		if contract != "" {
			contracts[family][contract] = true
		}
	}
	marker := false
	info, err := rawlog.ReadFile(filepath.Join(in, rel), func(r rawlog.Record) error {
		fs.Records++
		if isMarker(r) {
			marker = true
			return nil
		}
		if r.Venue == "polymarket" && r.Stream == "events" {
			var events []struct {
				Slug    string
				Markets []struct{ ConditionID string }
			}
			_ = json.Unmarshal(r.Msg, &events)
			for _, e := range events {
				for _, m := range e.Markets {
					pmFamily[m.ConditionID] = tap.PolymarketFamily(e.Slug)
				}
			}
		}
		if !dataStreams[r.Stream] {
			return nil
		}
		if r.Venue == "polymarket" { // an array of books, each naming its market
			for _, part := range bytes.Split(r.Msg, []byte(`"market":"`))[1:] {
				if id, _, ok := bytes.Cut(part, []byte(`"`)); ok {
					pmBooks[string(id)]++
				}
			}
		} else {
			f, c := familyOf(r)
			count(f, c, 1)
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
	for id, n := range pmBooks {
		count(pmFamily[id], id, n) // a book whose event wasn't seen in this file has no family
	}
	for f, cs := range contracts {
		fs.Families[f].Contracts = len(cs)
	}
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
	jsonOut := flag.String("json", "", "write a JSON report to this file instead of printing")
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

	start := time.Now().UTC() // the report's time: the files are listed now
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
		if s, ok := indexed[rel]; ok && s.V >= summaryVersion {
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

	if *jsonOut != "" {
		if err := writeReport(*jsonOut, start, *gap, venues, reports, paths, indexed); err != nil {
			log.Fatal(err)
		}
		return
	}

	fmt.Printf("Recorded data in %s (gap = no data for > %s, or a restart or disconnect)\n\n", *in, *gap)
	fmt.Printf("%-9s %-19s %-19s %8s %12s %6s %9s\n", "venue", "first (UTC)", "last (UTC)", "hours", "records", "gaps", "coverage")
	for _, v := range venues {
		r := reports[v]
		if r.first == 0 {
			fmt.Printf("%-9s no data\n", v)
			continue
		}
		fmt.Printf("%-9s %-19s %-19s %8.2f %12d %6d %8.3f%%\n", v, ts(r.first), ts(r.last),
			float64(r.last-r.first)/3.6e12, r.records, len(r.gaps), 100*coverage(r))
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
