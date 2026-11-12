package rawlog

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	gz, err := gzip.NewReader(fh)
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

func TestRotateAndNewFileAfterRestart(t *testing.T) {
	dir := t.TempDir()
	clock := time.Date(2026, 11, 2, 22, 59, 59, 0, time.UTC)
	now := func() time.Time { return clock }

	w := New(dir, now)
	must(t, w.Write("polymarket", "ws", []byte(`{"a":1}`)))
	clock = clock.Add(2 * time.Second) // crosses into 23:00:01
	must(t, w.Write("polymarket", "ws", []byte(`{"a":2}`)))
	must(t, w.Status("polymarket", "disconnected", "test"))
	must(t, w.Close())

	// A restart in the same hour opens its own file instead of appending to the old one.
	clock = clock.Add(10 * time.Minute)
	w = New(dir, now)
	must(t, w.Write("polymarket", "ws", []byte("PONG")))
	must(t, w.Close())

	day := filepath.Join(dir, "polymarket", "2026-11-02")
	h22 := readAll(t, filepath.Join(day, "22-5959.jsonl.gz"))
	h23 := readAll(t, filepath.Join(day, "23-0001.jsonl.gz"))
	restart := readAll(t, filepath.Join(day, "23-1001.jsonl.gz"))
	if len(h22) != 1 || string(h22[0].Msg) != `{"a":1}` {
		t.Fatalf("hour 22: %+v", h22)
	}
	if len(h23) != 2 || h23[1].Stream != "status" {
		t.Fatalf("hour 23: %+v", h23)
	}
	if len(restart) != 1 || string(restart[0].Msg) != `"PONG"` {
		t.Fatalf("after restart: %+v", restart)
	}
	files, err := Files(dir)
	must(t, err)
	if len(files) != 3 || filepath.Base(files[2]) != "23-1001.jsonl.gz" {
		t.Fatalf("files %v", files)
	}
}

func TestFlushMakesDataReadable(t *testing.T) {
	dir := t.TempDir()
	w := New(dir, func() time.Time { return time.Date(2026, 11, 2, 1, 0, 0, 0, time.UTC) })
	must(t, w.Write("kalshi", "orderbook", []byte(`{"x":1}`)))
	must(t, w.Flush())
	// Read without closing: a sync-flushed gzip stream is readable up to the flush point.
	fh, err := os.Open(filepath.Join(dir, "kalshi", "2026-11-02", "01-0000.jsonl.gz"))
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
	info, err := ReadFile(files[0], func(Record) error { n++; return nil })
	must(t, err)
	if n != 3 || !info.Truncated {
		t.Fatalf("read %d records, %+v", n, info)
	}
	must(t, w.Close())
	n = 0
	info, err = ReadFile(files[0], func(Record) error { n++; return nil })
	must(t, err)
	if n != 3 || info.Truncated || info.Corrupt != 0 {
		t.Fatalf("after close: read %d records, %+v", n, info)
	}
}

// A crash mid-write leaves a torn gzip block. Data written after it (an old-style append to the
// same file, as on 2026-11-12) must still be readable.
func TestReadFileRecoversAfterCorruption(t *testing.T) {
	dir := t.TempDir()
	member := func(lines ...string) []byte {
		var b bytes.Buffer
		gz := gzip.NewWriter(&b)
		for _, l := range lines {
			fmt.Fprintf(gz, `{"recv_ns":1,"venue":"kalshi","stream":"ws","msg":%s}`+"\n", l)
		}
		must(t, gz.Close())
		return b.Bytes()
	}
	first := member(`{"a":1}`, `{"a":2}`)
	torn := first[:len(first)-12] // the crash: the end of the block and the trailer never landed
	path := filepath.Join(dir, "kalshi", "2026-11-12", "17.jsonl.gz")
	must(t, os.MkdirAll(filepath.Dir(path), 0o755))
	must(t, os.WriteFile(path, append(torn, member(`{"b":1}`, `{"b":2}`, `{"b":3}`)...), 0o644))

	var got []string
	info, err := ReadFile(path, func(r Record) error { got = append(got, string(r.Msg)); return nil })
	must(t, err)
	if info.Corrupt != 1 || info.Truncated {
		t.Fatalf("info %+v", info)
	}
	if len(got) < 3 || got[len(got)-1] != `{"b":3}` {
		t.Fatalf("records after the damage were lost: %v", got)
	}
}

func TestFilesSortOldAndNewNames(t *testing.T) {
	dir := t.TempDir()
	for _, p := range []string{"kalshi/2026-11-12/17-0912.jsonl.gz", "kalshi/2026-11-12/17.jsonl.gz",
		"kalshi/2026-11-12/18-0000.jsonl.gz", "kalshi/2026-11-12/16-5959.jsonl.gz"} {
		must(t, os.MkdirAll(filepath.Join(dir, filepath.Dir(p)), 0o755))
		must(t, os.WriteFile(filepath.Join(dir, p), nil, 0o644))
	}
	files, err := Files(dir)
	must(t, err)
	var names []string
	for _, f := range files {
		names = append(names, filepath.Base(f))
	}
	want := []string{"16-5959.jsonl.gz", "17.jsonl.gz", "17-0912.jsonl.gz", "18-0000.jsonl.gz"}
	if strings.Join(names, " ") != strings.Join(want, " ") {
		t.Fatalf("order %v", names)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
