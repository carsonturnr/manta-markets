// Command news polls the official news feeds (internal/news, docs/plan-news-events.md) and
// appends each item it has not seen before, stamped with when we first received it, to
// DIR/<UTC day>.jsonl. replayserve serves that folder to the site. Every minute it writes each
// feed's poll counts to DIR/status.json, for the page's honest figures (failed polls included).
//
//	news -dir /var/lib/manta/replay/news
//
// With -moves (moves.go) it instead measures how the books moved around each item, from the
// hourly replay files, and exits: replay.sh runs it after each hour's replay.
//
// Times are this machine's clock (the VM syncs to ntp.hetzner.com; the offset is published).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/news"
)

// The client name Carson chose for BLS and DOL (docs/decisions.md, 2026-11-23); every feed gets it.
const userAgent = "manta-markets news timing (data@mantamarkets.com)"

const (
	// Items already in a feed at start are kept (as backfill) only if stated this recently: older
	// ones are history the page doesn't list (BEA's feed goes back ten months).
	backfillAge = 7 * 24 * time.Hour
	keepDays    = 31 // files read at start to know what was already seen
	maxBody     = 8 << 20
)

// feedStats is one feed's line in status.json.
type feedStats struct {
	Polls       int    `json:"polls"`
	NotModified int    `json:"not_modified"`
	Errors      int    `json:"errors"`
	LastError   string `json:"last_error,omitempty"`
	LastOkMs    int64  `json:"last_ok_ms,omitempty"`
	Items       int    `json:"items"`
	IntervalMs  int64  `json:"interval_ms"`
}

type collector struct {
	dir    string
	client *http.Client
	mu     sync.Mutex
	seen   map[string]bool // source + "\x00" + id
	stats  map[string]*feedStats
}

func main() {
	dir := flag.String("dir", "/var/lib/manta/replay/news", "output folder")
	moves := flag.Bool("moves", false, "compute the moves of items whose window has a replay, then exit (run by replay.sh)")
	replayDir := flag.String("replay", "/var/lib/manta/replay", "with -moves: the replay directory (cmd/replay's output)")
	releases := flag.String("releases", "/opt/manta/releases.tsv", "with -moves: event response's scheduled releases")
	series := flag.String("series", "", "with -moves: comma-separated Kalshi series to measure")
	flag.Parse()
	if *moves {
		if *series == "" {
			log.Fatal("usage: news -moves -dir DIR -replay DIR -releases FILE -series KXFED,…")
		}
		if err := runMoves(*dir, *replayDir, *releases, strings.Split(*series, ","), time.Now()); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		log.Fatal(err)
	}
	c := &collector{dir: *dir, client: &http.Client{Timeout: 20 * time.Second},
		seen: map[string]bool{}, stats: map[string]*feedStats{}}
	n, err := c.load(time.Now())
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%d items already recorded in the last %d days", n, keepDays)
	since := time.Now().UnixMilli()
	for _, src := range news.Sources {
		c.stats[src.Name] = &feedStats{}
		go c.poll(src)
	}
	for range time.Tick(time.Minute) {
		if err := c.writeStatus(since); err != nil {
			log.Printf("status: %v", err)
		}
	}
}

// load marks every item in the last keepDays daily files as seen; a damaged line is skipped.
func (c *collector) load(now time.Time) (int, error) {
	n := 0
	for d := range keepDays {
		day := now.UTC().AddDate(0, 0, -d).Format(time.DateOnly)
		body, err := os.ReadFile(filepath.Join(c.dir, day+".jsonl"))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return n, err
		}
		for line := range strings.Lines(string(body)) {
			var it news.Item
			if json.Unmarshal([]byte(line), &it) == nil {
				c.seen[key(it)] = true
				n++
			}
		}
	}
	return n, nil
}

func key(it news.Item) string { return it.Source + "\x00" + it.ID }

// fresh picks the items to record from one poll's parse: those not seen before, each once. On
// the first successful poll since start they are backfill (they may have appeared while we were
// down, so their receipt time is not real), and only those stated within backfillAge are kept;
// the older ones are only marked seen.
func fresh(src news.Source, items []news.Item, seen map[string]bool, first bool, now time.Time) []news.Item {
	var out []news.Item
	for _, it := range items {
		it.Source, it.StatedReal, it.ReceivedMs, it.Backfill = src.Name, src.StatedReal, now.UnixMilli(), first
		it.Key = news.Key(it)
		k := key(it)
		if seen[k] {
			continue
		}
		seen[k] = true
		if first && now.Sub(time.UnixMilli(it.StatedMs)) > backfillAge {
			continue
		}
		out = append(out, it)
	}
	return out
}

// poll fetches one feed forever, with conditional requests, at news.Interval's pace.
func (c *collector) poll(src news.Source) {
	var etag, modified string
	first, fails := true, 0
	for {
		body, status, h, err := c.fetch(src.URL, etag, modified)
		now := time.Now() // received: the body has fully arrived
		var items []news.Item
		if err == nil && status == http.StatusOK {
			items, err = src.Parse(body)
		}
		c.mu.Lock()
		st := c.stats[src.Name]
		st.Polls++
		switch {
		case err != nil:
			fails++
			st.Errors++
			st.LastError = fmt.Sprintf("%s: %v", now.UTC().Format(time.RFC3339), err)
			log.Printf("%s: %v", src.Name, err)
		case status == http.StatusNotModified:
			fails = 0
			st.NotModified++
			st.LastOkMs = now.UnixMilli()
		default:
			fails = 0
			st.LastOkMs = now.UnixMilli()
			etag, modified = h.Get("ETag"), h.Get("Last-Modified")
			for _, it := range fresh(src, items, c.seen, first, now) {
				if err := appendLine(filepath.Join(c.dir, time.UnixMilli(it.ReceivedMs).UTC().Format(time.DateOnly)+".jsonl"), it); err != nil {
					log.Printf("%s: writing %s: %v", src.Name, it.ID, err) // retried on the next poll
					delete(c.seen, key(it))
					continue
				}
				st.Items++
				if !it.Backfill {
					log.Printf("%s: %s (stated %s, %.1f s after)", src.Name, it.Title,
						time.UnixMilli(it.StatedMs).UTC().Format(time.TimeOnly), float64(it.ReceivedMs-it.StatedMs)/1e3)
				}
			}
			first = false
		}
		wait := news.Interval(src, time.Now(), fails)
		st.IntervalMs = wait.Milliseconds()
		c.mu.Unlock()
		time.Sleep(wait)
	}
}

// fetch makes one conditional GET. Any status but 200 and 304 is an error (403 and 429 included:
// the caller backs off).
func (c *collector) fetch(url, etag, modified string) ([]byte, int, http.Header, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if modified != "" {
		req.Header.Set("If-Modified-Since", modified)
	}
	res, err := c.client.Do(req)
	if err != nil {
		return nil, 0, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNotModified {
		return nil, res.StatusCode, nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBody))
	return body, res.StatusCode, res.Header, err
}

// writeStatus saves every feed's counts since start.
func (c *collector) writeStatus(since int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return writeJSON(filepath.Join(c.dir, "status.json"),
		map[string]any{"since_ms": since, "written_ms": time.Now().UnixMilli(), "feeds": c.stats})
}
