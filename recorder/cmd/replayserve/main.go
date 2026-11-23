// Command replayserve serves the replay files (cmd/replay) to the site's server, read-only:
//
//	GET /index                        {"<event>": ["2026-11-17T15", …], …}
//	GET /file/<event>/<hour>.json.gz  one event's hour, as written
//	GET /events                       ["2026-12-04-payrolls", …]: the event-response releases
//	GET /events/<release>.json        one release's event response (cmd/eventresponse)
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
)

// An event ticker and an hour, the only names the directory holds.
var fileName = regexp.MustCompile(`^/file/([A-Z0-9-]+)/(\d{4}-\d{2}-\d{2}T\d{2})\.json\.gz$`)

// A release id: its date and kind, e.g. 2026-12-04-payrolls.
var releaseName = regexp.MustCompile(`^/events/(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\.json$`)

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
		if m := releaseName.FindStringSubmatch(r.URL.Path); m != nil {
			f, err := root.Open("events/" + m[1] + ".json")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer f.Close()
			w.Header().Set("Content-Type", "application/json")
			io.Copy(w, f)
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
