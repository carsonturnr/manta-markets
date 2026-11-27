package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestServeNews(t *testing.T) {
	dir := t.TempDir()
	news := filepath.Join(dir, "news")
	if err := os.MkdirAll(news, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(news, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("2026-11-26.jsonl", `{"key":"a"}`+"\n")
	write("2026-11-27.jsonl", `{"key":"b"}`+"\n"+`{"key":"c"`) // c: cut off by a crash mid-write
	write("2026-10-01.jsonl", `{"key":"old"}`+"\n")            // more than 30 days back
	write("moves.jsonl", `{"key":"a","moved":3}`+"\n")
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	serveNews(rec, root, time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC))
	var got struct {
		Items, Moves []map[string]any
		Status       any
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 || got.Items[0]["key"] != "a" || got.Items[1]["key"] != "b" ||
		len(got.Moves) != 1 || got.Status != nil {
		t.Fatalf("got %s", rec.Body.String())
	}
}
