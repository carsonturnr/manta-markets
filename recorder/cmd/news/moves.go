package main

// news -moves: how the order books moved around each news item (docs/plan-news-events.md).
// Read from the hourly replay files' minute boundaries, not the raw recordings: a full
// event-response run parses every Kalshi record of the window (152 s of CPU on the Mac, ~6 min on
// the VM, docs/decisions.md 2026-11-23), while an hour of replay files is ~2 MB. The price is
// minute resolution: the move starts at the minute boundary at or before t0.

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/news"
	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

// movesFor is how many days of items are looked at: a window's replay is ready within ~2 hours.
const movesFor = 2

// summary is one line of DIR/moves.jsonl, the list page's view of an item's move. An item at a
// scheduled release has only Release: event response measures that moment (no double counting).
type summary struct {
	Key       string `json:"key"`
	T0        int64  `json:"t0"`
	T0Kind    string `json:"t0_kind"` // "stated" or "received"
	Release   string `json:"release,omitempty"`
	Contracts int    `json:"contracts"` // with a defined move: the sample size
	Moved     int    `json:"moved"`     // of those, by 1¢ or more
	// MovedBefore is the baseline: contracts that moved 1¢ or more in the 30 minutes before.
	MovedBefore int      `json:"moved_before"`
	Top         string   `json:"top,omitempty"`
	TopCents    *float64 `json:"top_cents,omitempty"`
}

// detail is DIR/moves/<key>.json, the item's own page.
type detail struct {
	Key       string      `json:"key"`
	T0        int64       `json:"t0"`
	T0Kind    string      `json:"t0_kind"`
	Contracts []news.Move `json:"contracts"`
}

func runMoves(dir, replayDir, releasesPath string, series []string, now time.Time) error {
	start := time.Now()
	releases, err := readReleases(releasesPath)
	if err != nil {
		return err
	}
	done := map[string]bool{}
	if err := eachLine(filepath.Join(dir, "moves.jsonl"), func(b []byte) {
		var s summary
		if json.Unmarshal(b, &s) == nil {
			done[s.Key] = true
		}
	}); err != nil {
		return err
	}
	var items []news.Item
	for d := range movesFor {
		path := filepath.Join(dir, now.UTC().AddDate(0, 0, -d).Format(time.DateOnly)+".jsonl")
		if err := eachLine(path, func(b []byte) {
			var it news.Item
			if json.Unmarshal(b, &it) == nil && it.Key != "" {
				items = append(items, it)
			}
		}); err != nil {
			return err
		}
	}
	events, err := fs.ReadDir(os.DirFS(replayDir), ".")
	if err != nil {
		return err
	}
	var wanted []string // the event folders of the measured series
	for _, e := range events {
		for _, s := range series {
			if e.IsDir() && strings.HasPrefix(e.Name(), strings.TrimSpace(s)+"-") {
				wanted = append(wanted, e.Name())
			}
		}
	}
	hours := map[string]map[string][]replay.Minute{} // hour → ticker → minutes, read once each
	n := 0
	for _, it := range items {
		t0, kind, ok := news.T0(it)
		if !ok || done[it.Key] {
			continue
		}
		s := summary{Key: it.Key, T0: t0, T0Kind: kind}
		if id, ok := news.AtRelease(t0, releases); ok {
			s.Release = id
		} else {
			from, to := news.Window(t0)
			var need []string
			for h := from - from%3_600_000; h <= to; h += 3_600_000 {
				need = append(need, time.UnixMilli(h).UTC().Format("2006-01-02T15"))
			}
			if slices.ContainsFunc(need, func(h string) bool { return !exists(filepath.Join(replayDir, ".done", h)) }) {
				continue // its window's replay isn't written yet: next hour
			}
			minutes := map[string][]replay.Minute{}
			for _, h := range need {
				if hours[h] == nil {
					hours[h] = readHour(replayDir, wanted, h)
				}
				for ticker, ms := range hours[h] {
					minutes[ticker] = append(minutes[ticker], ms...)
				}
			}
			moves := news.Moves(t0, minutes)
			if err := writeJSON(filepath.Join(dir, "moves", it.Key+".json"), detail{it.Key, t0, kind, moves}); err != nil {
				return err
			}
			for _, m := range moves {
				if m.MoveCents == nil {
					continue
				}
				if s.Contracts++; *m.MoveCents >= 1 || *m.MoveCents <= -1 {
					s.Moved++
				}
				if b := m.BeforeCents; b != nil && (*b >= 1 || *b <= -1) {
					s.MovedBefore++
				}
				if s.Top == "" {
					s.Top, s.TopCents = m.Ticker, m.MoveCents
				}
			}
		}
		if err := appendLine(filepath.Join(dir, "moves.jsonl"), s); err != nil {
			return err
		}
		done[it.Key] = true
		n++
	}
	log.Printf("moves: %d items measured or linked, %d hours read, in %s", n, len(hours), time.Since(start).Round(time.Millisecond))
	return nil
}

// readHour reads one hour's replay files of the wanted events; a missing or damaged file is
// skipped (that event was not recorded then, or its replay failed: its contracts have no move).
func readHour(replayDir string, events []string, hour string) map[string][]replay.Minute {
	out := map[string][]replay.Minute{}
	for _, ev := range events {
		f, err := os.Open(filepath.Join(replayDir, ev, hour+".json.gz"))
		if err != nil {
			continue
		}
		var file struct {
			Markets map[string]replay.Market `json:"markets"`
		}
		z, err := gzip.NewReader(f)
		if err == nil {
			err = json.NewDecoder(z).Decode(&file)
		}
		f.Close()
		if err != nil {
			log.Printf("%s/%s: %v", ev, hour, err)
			continue
		}
		for ticker, m := range file.Markets {
			out[ticker] = append(out[ticker], m.Minutes...)
		}
	}
	return out
}

// readReleases reads releases.tsv (id, t0, name; # comments). A missing file means none.
func readReleases(path string) ([]news.Release, error) {
	var out []news.Release
	err := eachLine(path, func(b []byte) {
		f := strings.Split(strings.TrimSpace(string(b)), "\t")
		if len(f) < 2 || strings.HasPrefix(f[0], "#") {
			return
		}
		if t, err := time.Parse(time.RFC3339, f[1]); err == nil {
			out = append(out, news.Release{ID: f[0], T0: t.UnixMilli()})
		}
	})
	return out, err
}

// eachLine calls f with each line of a file; a missing file has none.
func eachLine(path string, f func([]byte)) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	sc := bufio.NewScanner(file)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		f(sc.Bytes())
	}
	return sc.Err()
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func appendLine(path string, v any) error {
	line, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// writeJSON saves v through a temporary file, so a reader never sees half of it.
func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(path), ".tmp-"+filepath.Base(path))
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return os.Rename(tmp, path)
}
