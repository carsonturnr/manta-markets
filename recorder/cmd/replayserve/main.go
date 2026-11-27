// Command replayserve serves the replay files (cmd/replay) to the site's server, read-only:
//
//	GET /index                        {"<event>": ["2026-11-17T15", …], …}
//	GET /file/<event>/<hour>.json.gz  one event's hour, as written
//	GET /events                       ["2026-12-04-payrolls", …]: the event-response releases
//	GET /events/<release>.json        one release's event response (cmd/eventresponse)
//	GET /candles/<ticker>             one Kalshi market's 1-minute candles over its last 24 recorded hours
//	GET /news                         {"items", "moves", "status"}: the last 30 days of news (cmd/news)
//	GET /news/moves/<key>.json        one news item's move around it (news -moves)
//
// Every request must carry "Authorization: Bearer <REPLAY_TOKEN>"; only the site's server knows
// it. Paths are opened through os.Root, which refuses anything outside the replay directory.
// Served over TLS with the relay's self-signed certificate (the site trusts exactly that one,
// RELAY_CA), so the token and the files never cross the internet in the clear.
//
//	REPLAY_TOKEN=… replayserve -dir /var/lib/manta/replay -addr :8790
//	REPLAY_TOKEN=… replayserve -dir data/replay -tls-cert "" # plain HTTP, local testing only
package main

import (
	"compress/gzip"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"flag"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

// An event ticker and an hour, the only names the directory holds.
var fileName = regexp.MustCompile(`^/file/([A-Z0-9-]+)/(\d{4}-\d{2}-\d{2}T\d{2})\.json\.gz$`)

// A Kalshi market ticker, e.g. KXBTCD-26NOV2517-T59749.99.
var tickerName = regexp.MustCompile(`^/candles/([A-Z0-9][A-Z0-9.-]*)$`)

// A release id: its date and kind, e.g. 2026-12-04-payrolls.
var releaseName = regexp.MustCompile(`^/events/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\.json$`)

// A news item's key: its day, source and a short hash, e.g. 2026-11-25-fed-press-ebcc18ee.
var newsMoveName = regexp.MustCompile(`^/news/moves/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\.json$`)

func main() {
	dir := flag.String("dir", "/var/lib/manta/replay", "replay directory")
	addr := flag.String("addr", ":8790", "listen address")
	certFile := flag.String("tls-cert", "/etc/manta/relay.crt", "TLS certificate, the relay's (deploy.sh makes it); empty serves plain HTTP")
	keyFile := flag.String("tls-key", "/etc/manta/relay.key", "TLS private key")
	flag.Parse()
	token := os.Getenv("REPLAY_TOKEN")
	if len(token) < 32 {
		log.Fatal("REPLAY_TOKEN must be set (32+ characters)")
	}
	root, err := os.OpenRoot(*dir)
	if err != nil {
		log.Fatal(err)
	}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/index" {
			serveIndex(w, root)
			return
		}
		if r.URL.Path == "/events" {
			serveReleases(w, root)
			return
		}
		if m := tickerName.FindStringSubmatch(r.URL.Path); m != nil {
			serveCandles(w, root, m[1])
			return
		}
		if r.URL.Path == "/news" {
			serveNews(w, root, time.Now())
			return
		}
		if m := releaseName.FindStringSubmatch(r.URL.Path); m != nil {
			serveJSON(w, r, root, "events/"+m[1]+".json")
			return
		}
		if m := newsMoveName.FindStringSubmatch(r.URL.Path); m != nil {
			serveJSON(w, r, root, "news/moves/"+m[1]+".json")
			return
		}
		m := fileName.FindStringSubmatch(r.URL.Path)
		if m == nil {
			http.NotFound(w, r)
			return
		}
		f, err := root.Open(m[1] + "/" + m[2] + ".json.gz")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/gzip")
		io.Copy(w, f)
	})
	srv := &http.Server{Addr: *addr, Handler: h, ReadTimeout: 10 * time.Second,
		WriteTimeout: 60 * time.Second, MaxHeaderBytes: 8 << 10}
	if *certFile == "" {
		log.Fatal(srv.ListenAndServe())
	}
	cert, err := tls.LoadX509KeyPair(*certFile, *keyFile)
	if err != nil {
		log.Fatal(err)
	}
	srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}
	log.Fatal(srv.ListenAndServeTLS("", ""))
}

// serveIndex lists each event's hours, oldest first.
func serveIndex(w http.ResponseWriter, root *os.Root) {
	out := map[string][]string{}
	events, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		http.Error(w, "index unavailable", http.StatusInternalServerError)
		return
	}
	for _, ev := range events {
		if !ev.IsDir() {
			continue
		}
		hours, err := fs.ReadDir(root.FS(), ev.Name())
		if err != nil {
			continue
		}
		for _, h := range hours {
			if name, ok := strings.CutSuffix(h.Name(), ".json.gz"); ok && !strings.HasPrefix(name, ".") {
				out[ev.Name()] = append(out[ev.Name()], name)
			}
		}
		slices.Sort(out[ev.Name()])
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// serveReleases lists the release ids in events/, oldest first; none yet is an empty list.
func serveReleases(w http.ResponseWriter, root *os.Root) {
	out := []string{}
	files, _ := fs.ReadDir(root.FS(), "events") // missing folder: no release yet
	for _, f := range files {
		if name, ok := strings.CutSuffix(f.Name(), ".json"); ok && !strings.HasPrefix(name, ".") {
			out = append(out, name)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// serveJSON sends one JSON file as written, or 404.
func serveJSON(w http.ResponseWriter, r *http.Request, root *os.Root, path string) {
	f, err := root.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, f)
}

// newsDays is how many daily news files /news returns.
const newsDays = 30

// serveNews answers the news page's data in one response: every item of the last newsDays days
// (news/<day>.jsonl), every move summary (news/moves.jsonl) and the collector's poll counts
// (news/status.json, null if absent). Lines are passed through as written; a damaged one (a
// crash mid-write) is skipped. Nothing recorded yet is empty lists.
func serveNews(w http.ResponseWriter, root *os.Root, now time.Time) {
	out := struct {
		Items  []json.RawMessage `json:"items"`
		Moves  []json.RawMessage `json:"moves"`
		Status json.RawMessage   `json:"status"`
	}{Items: []json.RawMessage{}, Moves: []json.RawMessage{}, Status: json.RawMessage("null")}
	lines := func(path string, into *[]json.RawMessage) {
		body, err := fs.ReadFile(root.FS(), path)
		if err != nil {
			return // missing: nothing recorded that day
		}
		for line := range strings.Lines(string(body)) {
			if b := []byte(strings.TrimSpace(line)); json.Valid(b) {
				*into = append(*into, b)
			}
		}
	}
	for d := newsDays - 1; d >= 0; d-- { // oldest first, as the files were written
		lines("news/"+now.UTC().AddDate(0, 0, -d).Format(time.DateOnly)+".jsonl", &out.Items)
	}
	lines("news/moves.jsonl", &out.Moves)
	if b, err := fs.ReadFile(root.FS(), "news/status.json"); err == nil && json.Valid(b) {
		out.Status = b
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// candleHours is how far back /candles reads: the site's 1-minute charts show the last day.
const candleHours = 24

// serveCandles answers one market's 1-minute candles (replay.Candles) from its event's last
// candleHours hour files, oldest first; a market with no recording yet is an empty list.
func serveCandles(w http.ResponseWriter, root *os.Root, ticker string) {
	ev := replay.Event(ticker)
	hours, _ := fs.ReadDir(root.FS(), ev) // missing folder: not recorded
	var names []string
	for _, h := range hours {
		if name, ok := strings.CutSuffix(h.Name(), ".json.gz"); ok && !strings.HasPrefix(name, ".") {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	if len(names) > candleHours {
		names = names[len(names)-candleHours:]
	}
	var minutes []replay.Minute
	var trades []replay.Trade
	for _, name := range names {
		var file struct {
			Markets map[string]replay.Market `json:"markets"`
		}
		if err := readGz(root, ev+"/"+name+".json.gz", &file); err != nil {
			log.Printf("candles %s: %s: %v", ticker, name, err) // a damaged hour is skipped
			continue
		}
		m := file.Markets[ticker]
		minutes = append(minutes, m.Minutes...)
		trades = append(trades, m.Trades...)
	}
	out := replay.Candles(minutes, trades)
	if out == nil {
		out = []replay.Candle{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func readGz(root *os.Root, path string, v any) error {
	f, err := root.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer z.Close()
	return json.NewDecoder(z).Decode(v)
}
