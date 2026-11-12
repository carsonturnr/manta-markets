package rawlog

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func readAll(t *testing.T, path string) []Record {
	t.Helper()
	fh, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	gz, err := gzip.NewReader(fh) // multistream by default: reads appended members
	if err != nil {
		t.Fatal(err)
	}
	var out []Record
	sc := bufio.NewScanner(gz)
	for sc.Scan() {
		var r Record
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestRotateAndAppendAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	clock := time.Date(2026, 11, 2, 22, 59, 59, 0, time.UTC)
	now := func() time.Time { return clock }

	w := New(dir, now)
	must(t, w.Write("polymarket", "ws", []byte(`{"a":1}`)))
	clock = clock.Add(2 * time.Second) // crosses into 23:00
	must(t, w.Write("polymarket", "ws", []byte(`{"a":2}`)))
	must(t, w.Status("polymarket", "disconnected", "test"))
	must(t, w.Close())

	// Restart in the same hour appends a second gzip member.
	w = New(dir, now)
	must(t, w.Write("polymarket", "ws", []byte("PONG")))
	must(t, w.Close())

	h22 := readAll(t, filepath.Join(dir, "polymarket", "2026-11-02", "22.jsonl.gz"))
	h23 := readAll(t, filepath.Join(dir, "polymarket", "2026-11-02", "23.jsonl.gz"))
	if len(h22) != 1 || string(h22[0].Msg) != `{"a":1}` {
		t.Fatalf("hour 22: %+v", h22)
	}
	if len(h23) != 3 {
		t.Fatalf("hour 23: want 3 records, got %d", len(h23))
	}
	if h23[1].Stream != "status" || string(h23[2].Msg) != `"PONG"` {
		t.Fatalf("hour 23: %+v", h23)
	}
}

func TestFlushMakesDataReadable(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, func() time.Time { return time.Date(2026, 11, 2, 1, 0, 0, 0, time.UTC) })
	must(t, w.Write("kalshi", "orderbook", []byte(`{"x":1}`)))
	must(t, w.Flush())
	// Read without closing: a sync-flushed gzip stream is readable up to the flush point.
	fh, err := os.Open(filepath.Join(dir, "kalshi", "2026-11-02", "01.jsonl.gz"))
	must(t, err)
	defer fh.Close()
	gz, err := gzip.NewReader(fh)
	must(t, err)
	sc := bufio.NewScanner(gz)
	if !sc.Scan() {
		t.Fatal("no record readable after Flush")
	}
	must(t, w.Close())
}

func TestReadFileToleratesOpenFile(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, func() time.Time { return time.Date(2026, 11, 2, 3, 0, 0, 0, time.UTC) })
	for i := range 3 {
		must(t, w.Write("hyperliquid", "ws", []byte(`{"i":`+string(rune('0'+i))+`}`)))
	}
	must(t, w.Flush()) // no Close: the gzip trailer is missing, as for the live hour
	files, err := Files(dir)
	must(t, err)
	if len(files) != 1 {
		t.Fatalf("files %v", files)
	}
	var n int
	truncated, err := ReadFile(files[0], func(Record) error { n++; return nil })
	must(t, err)
	if n != 3 || !truncated {
		t.Fatalf("read %d records, truncated=%v", n, truncated)
	}
	must(t, w.Close())
	n = 0
	truncated, err = ReadFile(files[0], func(Record) error { n++; return nil })
	must(t, err)
	if n != 3 || truncated {
		t.Fatalf("after close: read %d records, truncated=%v", n, truncated)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
