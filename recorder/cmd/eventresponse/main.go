// Command eventresponse measures how Kalshi contracts reacted to one scheduled release
// (internal/eventresponse, docs/plan-event-response.md): it rebuilds each listed contract's
// book from the raw recordings over t0 − 15 min to t0 + 30 min and writes one JSON file per
// release, DIR/events/<release>.json, for the site's event pages.
//
//	eventresponse -release 2026-12-04-payrolls -name "Payrolls and unemployment" \
//	  -t0 2026-12-04T13:30:00Z -series KXFEDDECISION,KXFED -out DIR  13-0000.jsonl.gz 14-0000.jsonl.gz
//
// Give the raw files in time order, starting with the one holding the warm-up (the 20 minutes
// before the window): Kalshi sends full books only when the recorder (re)subscribes, so books
// need that long to have all had a snapshot. Books are rebuilt as cmd/replay does (normalize,
// then book), and a book is left out from a gap until its next snapshot, as the relay does.
//
// Times are Kalshi's own message timestamp (ts_ms) where it has one, our receive time otherwise
// (snapshots carry none through the normalizer). Receive time trails ts_ms by ~55 ms, up to
// 0.7 s in bursts (docs/decisions.md, 2026-11-23).
package main

import (
	"cmp"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/eventresponse"
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/normalize"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

const (
	before = 15 * time.Minute // the window starts this long before t0
	// The usual spread is measured up to a minute before t0, so pre-release jitter doesn't count.
	usualEnd = time.Minute
	window   = time.Duration(eventresponse.Window) * time.Millisecond
)

// The release id is the file name: date and kind, lower case.
var releaseID = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`)

// contract is one Kalshi market being followed.
type contract struct {
	book    *book.Book
	trusted bool                   // had a snapshot since its last gap
	samples []eventresponse.Sample // the book after each change in the window
	changes int                    // book changes in the window
	lastT   int64                  // latest sample time: samples never go back in time
	rawT    int64                  // latest message time as stamped, to measure disorder
	lostAt  int64                  // when it was untrusted inside the window (0: it wasn't)
}

// run holds the state of one pass over the files.
type run struct {
	prefixes  []string
	from, to  int64 // the window, unix ms
	seeded    bool  // every trusted book has had a sample at the window's start
	contracts map[string]*contract

	backwards, maxBack int64 // changes stamped earlier than the contract's previous one
	stamped, recvOnly  int64 // changes in the window timed by ts_ms / by receive time
	gaps               int   // books untrusted inside the window (resubscribes and gaps)
	lostMs, maxLostMs  int64 // how long those books waited for their next snapshot
}

func main() {
	release := flag.String("release", "", "release id, the output file's name (2026-12-04-payrolls)")
	name := flag.String("name", "", "release name for the page (Payrolls and unemployment)")
	t0s := flag.String("t0", "", "release time, RFC 3339 (2026-12-04T13:30:00Z)")
	series := flag.String("series", "", "comma-separated Kalshi series to include")
	standin := flag.Bool("standin", false, "a test run on a non-release moment")
	out := flag.String("out", "replay", "the replay directory; the file goes in its events/ folder")
	warmup := flag.Duration("warmup", 20*time.Minute, "how much of the time before the window to read")
	vmOffset := flag.Int64("vm-offset-us", 47, "VM clock offset, µs (timedatectl timesync-status)")
	bound := flag.Int64("bound-ms", 24, "VM clock worst-case bound, ms (root distance)")
	flag.Parse()
	t0, err := time.Parse(time.RFC3339, *t0s)
	if err != nil || !releaseID.MatchString(*release) || *name == "" || *series == "" || flag.NArg() == 0 {
		log.Fatal(`usage: eventresponse -release 2026-12-04-payrolls -name "…" -t0 2026-12-04T13:30:00Z -series KXFED,… -out DIR FILE.jsonl.gz...`)
	}
	r := &run{from: t0.Add(-before).UnixMilli(), to: t0.Add(window).UnixMilli(),
		contracts: map[string]*contract{}}
	for _, s := range strings.Split(*series, ",") {
		r.prefixes = append(r.prefixes, strings.TrimSpace(s)+"-")
	}
	n, err := normalize.New("kalshi")
	if err != nil {
		log.Fatal(err)
	}

	start := time.Now()
	skipBefore := t0.Add(-before - *warmup).UnixNano()
	// Stop a few seconds past the window: receive time trails Kalshi's stamps by up to ~0.7 s.
	stopAfter := t0.Add(window + 5*time.Second).UnixNano()
	done := errors.New("past the window")
	var records int64
	for _, path := range flag.Args() {
		truncated, err := rawlog.Stream(path, func(rec rawlog.Record) error {
			if rec.RecvNs < skipBefore {
				return nil // parsed only as far as its time: most of the warm-up's cost saved
			}
			if rec.RecvNs > stopAfter {
				return done
			}
			records++
			r.handle(rec, n.Handle(rec))
			return nil
		})
		if errors.Is(err, done) {
			break
		}
		if err != nil {
			log.Fatalf("%s: %v", path, err)
		}
		if truncated {
			log.Printf("%s: ends mid-record or damaged (crash or still being written); records up to there kept", path)
		}
	}

	doc := output{Release: *release, Name: *name, T0: t0.UnixMilli(), Standin: *standin,
		Clock:     clock{VMOffsetUs: *vmOffset, BoundMs: *bound, TimeSource: "kalshi ts_ms; receive time where a venue has none"},
		Contracts: r.results(t0.UnixMilli())}
	path := filepath.Join(*out, "events", *release+".json")
	size, err := write(path, doc)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s: %d contracts, %.1f MB, %d records read in %s\n", path, len(doc.Contracts),
		float64(size)/1e6, records, time.Since(start).Round(time.Millisecond))
	fmt.Printf("changes in window: %d timed by ts_ms, %d by receive time; %d stamped earlier than the contract's previous change (max %d ms back); %d books untrusted (resubscribes and gaps), waiting %.1f s on average (max %.1f s) for a snapshot\n",
		r.stamped, r.recvOnly, r.backwards, r.maxBack, r.gaps, float64(r.lostMs)/1e3/float64(max(r.gaps, 1)), float64(r.maxLostMs)/1e3)
}

func (r *run) wanted(id string) bool {
	for _, p := range r.prefixes {
		if strings.HasPrefix(id, p) {
			return true
		}
	}
	return false
}

// handle applies one raw record and the messages the normalizer made of it, in file order.
func (r *run) handle(rec rawlog.Record, msgs []md.Msg) {
	if !r.seeded && rec.RecvNs/1e6 >= r.from {
		// The window opens: each trusted book's standing state is its first sample.
		r.seeded = true
		for _, c := range r.contracts {
			if c.trusted {
				c.lastT = max(c.lastT, r.from)
				c.samples = append(c.samples, sample(c.book, r.from))
			}
		}
	}
	if rec.Stream == "subscribe" { // a new connection: every book waits for its new snapshot
		r.untrustAll(rec.RecvNs)
	}
	for _, m := range msgs {
		switch m := m.(type) {
		case *md.Book:
			if m.Source != "ws" || !r.wanted(m.MarketID) {
				continue // REST books are the recorder's cross-checks, not part of the stream
			}
			c := r.contracts[m.MarketID]
			if c == nil {
				c = &contract{book: book.New()}
				r.contracts[m.MarketID] = c
			}
			if m.Kind == md.Snapshot {
				if !c.trusted && c.lostAt > 0 {
					wait := m.RecvTs/1e6 - c.lostAt
					r.lostMs += wait
					r.maxLostMs = max(r.maxLostMs, wait)
					c.lostAt = 0
				}
				c.book.Reset()
				c.trusted = true
			}
			replay.Apply(c.book, book.Bid, m.Bids)
			replay.Apply(c.book, book.Ask, m.Asks)
			t := m.RecvTs / 1e6
			if m.VenueTsMs != nil {
				t = *m.VenueTsMs
			}
			if t < c.rawT && t >= r.from {
				r.backwards++
				r.maxBack = max(r.maxBack, c.rawT-t)
			}
			c.rawT = max(c.rawT, t)
			if !c.trusted || !r.seeded || t > r.to {
				continue
			}
			// Kalshi's sequence order is the book's true order: a change stamped earlier than the
			// one before it is placed at the earlier one's time.
			t = max(t, c.lastT)
			c.lastT = t
			// Most changes are away from the mid: kept to the levels the figures read, the book is
			// often the same as before, and the earlier sample already stands for it.
			if s := sample(c.book, t); len(c.samples) == 0 || !same(c.samples[len(c.samples)-1], s) {
				c.samples = append(c.samples, s)
			}
			c.changes++
			if m.VenueTsMs != nil {
				r.stamped++
			} else {
				r.recvOnly++
			}
		case *md.Status:
			switch {
			case m.State == md.Gap && m.MarketID != nil:
				if c := r.contracts[*m.MarketID]; c != nil {
					r.untrust(c, m.Ts)
				}
			case m.State == md.Gap || m.State == md.Disconnected:
				r.untrustAll(m.Ts)
			}
		}
	}
}

// untrust leaves a contract out until its next snapshot. Inside the window it gets an empty
// sample, so its last good book doesn't appear to stand through the gap.
func (r *run) untrust(c *contract, ns int64) {
	if !c.trusted {
		return
	}
	c.trusted = false
	if t := max(ns/1e6, c.lastT); r.seeded && t <= r.to {
		c.lastT = t
		c.samples = append(c.samples, eventresponse.Sample{T: t})
		c.lostAt = ns / 1e6
		r.gaps++
	}
}

func (r *run) untrustAll(ns int64) {
	for _, c := range r.contracts {
		r.untrust(c, ns)
	}
}

func same(a, b eventresponse.Sample) bool {
	return slices.Equal(a.Bids, b.Bids) && slices.Equal(a.Asks, b.Asks)
}

func sample(bk *book.Book, t int64) eventresponse.Sample {
	return eventresponse.Near(eventresponse.Sample{T: t, Bids: bk.Levels(book.Bid), Asks: bk.Levels(book.Ask)})
}

type output struct {
	Release   string   `json:"release"`
	Name      string   `json:"name"`
	T0        int64    `json:"t0"`
	Standin   bool     `json:"standin"`
	Clock     clock    `json:"clock"`
	Contracts []result `json:"contracts"`
}

type clock struct {
	VMOffsetUs int64  `json:"vm_offset_us"`
	BoundMs    int64  `json:"bound_ms"`
	TimeSource string `json:"time_source"`
}

// result is one contract's line on the page; nil fields are written as null (undefined).
type result struct {
	Venue       string       `json:"venue"`
	Ticker      string       `json:"ticker"`
	Event       string       `json:"event"`
	Mids        [][2]float64 `json:"mids"`
	MoveCents   *float64     `json:"move_cents"`
	TimeTo90Ms  *int64       `json:"time_to_90_ms"`
	Depth10m    *float64     `json:"depth_10m_before"`
	Depth30s    *float64     `json:"depth_30s_before"`
	SpreadT0    *float64     `json:"spread_t0_cents"`
	SpreadUsual *float64     `json:"spread_usual_cents"`
	Changes     int          `json:"changes"`
	absMove     float64
	hasMove     bool
}

// results computes each contract's figures, biggest moves first, then those with no move.
// A contract with no two-sided price at any point in the window is left out.
func (r *run) results(t0 int64) []result {
	out := []result{}
	for id, c := range r.contracts {
		mids := midSeries(c.samples)
		if len(mids) == 0 {
			continue
		}
		res := result{Venue: "kalshi", Ticker: id, Event: replay.Event(id), Mids: mids, Changes: c.changes}
		s := c.samples
		if v, ok := eventresponse.Move(s, t0); ok {
			res.MoveCents, res.absMove, res.hasMove = round(v), math.Abs(v), true
		}
		if v, ok := eventresponse.TimeTo90(s, t0); ok {
			res.TimeTo90Ms = &v
		}
		if early, late, ok := eventresponse.Thinning(s, t0); ok {
			res.Depth10m, res.Depth30s = round(early), round(late)
		}
		if v, ok := eventresponse.SpreadAt(s, t0); ok {
			res.SpreadT0 = round(v)
		}
		if v, ok := eventresponse.UsualSpread(s, r.from, t0-usualEnd.Milliseconds()); ok {
			res.SpreadUsual = round(v)
		}
		out = append(out, res)
	}
	slices.SortFunc(out, func(a, b result) int {
		if a.hasMove != b.hasMove {
			if a.hasMove {
				return -1
			}
			return 1
		}
		return cmp.Or(cmp.Compare(b.absMove, a.absMove), strings.Compare(a.Ticker, b.Ticker))
	})
	return out
}

// midSeries is the chart line: [unix ms, mid in cents] for the last mid in each second the mid
// changed, stamped with the moment it took that value. Moments with no two-sided price add no
// point.
func midSeries(samples []eventresponse.Sample) [][2]float64 {
	var pts [][2]float64
	prev := math.NaN()
	for _, s := range samples {
		m, ok := s.Mid()
		if !ok {
			prev = math.NaN() // after a one-sided moment, the next mid counts as a change
			continue
		}
		if m == prev {
			continue // the mid's point already stands
		}
		prev = m
		p := [2]float64{float64(s.T), *round(m)}
		if n := len(pts); n > 0 && int64(pts[n-1][0])/1000 == s.T/1000 {
			pts[n-1] = p // a later change in the same second replaces the earlier one
		} else {
			pts = append(pts, p)
		}
		// Drop a point that only returns to the mid before it (no change in that second).
		if n := len(pts); n > 1 && pts[n-1][1] == pts[n-2][1] {
			pts = pts[:n-1]
		}
	}
	return pts
}

// round gives cents to 2 decimal places, so a float like 45.500000001 is written as 45.5.
func round(v float64) *float64 {
	r := math.Round(v*100) / 100
	return &r
}

// write saves v as JSON, through a temporary file so a reader never sees half a file.
func write(path string, v any) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return 0, err
	}
	defer os.Remove(f.Name())
	if err := json.NewEncoder(f).Encode(v); err != nil {
		return 0, err
	}
	st, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	return st.Size(), os.Rename(f.Name(), path)
}
