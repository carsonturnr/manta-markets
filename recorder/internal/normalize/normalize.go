// Package normalize turns raw tap records (internal/rawlog) into md.v1 messages and checks
// book consistency as it goes. The same code runs live (recorder) and over archived files
// (replay), so archived data and live data are normalized identically.
package normalize

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// Stats counts what a normalizer saw. Mismatch counters exclude books already known to be
// stale (after a disconnect or restart): those land in AfterGapMismatches.
type Stats struct {
	Records          uint64 `json:"records"`
	Msgs             uint64 `json:"msgs"`
	Ignored          uint64 `json:"ignored"`
	Duplicates       uint64 `json:"duplicates"`
	ParseErrors      uint64 `json:"parse_errors"`
	Gaps             uint64 `json:"gaps"` // disconnects and restarts
	DeltaChecks      uint64 `json:"delta_checks"`
	DeltaMismatches  uint64 `json:"delta_mismatches"`
	RestCompares     uint64 `json:"rest_compares"`
	RestMismatches   uint64 `json:"rest_mismatches"`
	RestUnaligned    uint64 `json:"rest_unaligned"`
	RestHashBad      uint64 `json:"rest_hash_bad"`
	WSSnapCompares   uint64 `json:"ws_snapshot_compares"`
	WSSnapMismatches uint64 `json:"ws_snapshot_mismatches"`
	// Snapshots (WebSocket or REST) missing some of their own millisecond's updates, completed
	// from the feed before comparing or adopting (Polymarket).
	SnapsCompleted     uint64 `json:"snapshots_completed"`
	AfterGapMismatches uint64 `json:"after_gap_mismatches"`
	// Coverage: share of wall-clock time, summed over markets from each market's first record,
	// during which its book was verified-consistent (SPEC §5 Phase 1).
	CoveragePct float64 `json:"coverage_pct"`
	Markets     int     `json:"markets"`
	// The markets with the lowest coverage, to see where the uncovered time goes.
	Worst    []MarketCoverage `json:"worst,omitempty"`
	Examples []string         `json:"examples,omitempty"` // first mismatch details
}

const maxExamples = 20

func (s *Stats) example(format string, args ...any) {
	if len(s.Examples) < maxExamples {
		s.Examples = append(s.Examples, fmt.Sprintf(format, args...))
	}
}

// Normalizer handles one venue's records.
type Normalizer interface {
	Handle(r rawlog.Record) []md.Msg
	Stats() *Stats
}

// New returns the normalizer for a venue.
func New(venue string) (Normalizer, error) {
	switch venue {
	case "kalshi":
		return newKalshi(), nil
	case "deribit", "coinbase", "kraken":
		return &feed{base: newBase(venue)}, nil
	}
	return nil, fmt.Errorf("normalize: unknown venue %q", venue)
}

// base holds what every venue shares: per-market recorder sequence numbers, coverage and stats.
type base struct {
	venue string
	seq   map[string]uint64
	cov   map[string]*coverage
	last  int64 // recv_ns of the latest record
	stats Stats
}

type coverage struct {
	first, since, clean int64
	ok                  bool
	end                 int64 // retired (market closed) at; 0 while open
}

func newBase(venue string) base {
	return base{venue: venue, seq: map[string]uint64{}, cov: map[string]*coverage{}}
}

// MarketCoverage is one market's share of verified-consistent time.
type MarketCoverage struct {
	Market       string  `json:"market"`
	CoveragePct  float64 `json:"coverage_pct"`
	UncoveredHrs float64 `json:"uncovered_h"`
}

const worstN = 10

// Stats returns the counters with coverage computed up to the latest record.
func (b *base) Stats() *Stats {
	var clean, total int64
	var per []MarketCoverage
	for m, c := range b.cov {
		last := b.last
		if c.end != 0 {
			last = c.end
		}
		cc := c.clean
		if c.ok {
			cc += last - c.since
		}
		span := last - c.first
		clean += cc
		total += span
		if span > 0 {
			per = append(per, MarketCoverage{m, 100 * float64(cc) / float64(span), float64(span-cc) / 3.6e12})
		}
	}
	slices.SortFunc(per, func(x, y MarketCoverage) int { return cmp.Compare(y.UncoveredHrs, x.UncoveredHrs) })
	b.stats.Worst = per[:min(worstN, len(per))]
	b.stats.Markets = len(b.cov)
	b.stats.CoveragePct = 0
	if total > 0 {
		b.stats.CoveragePct = 100 * float64(clean) / float64(total)
	}
	return &b.stats
}

func (b *base) tick(ts int64) { b.last = max(b.last, ts) }

// setClean records whether a market's book is verified-consistent from ts on.
func (b *base) setClean(market string, ts int64, ok bool) {
	c := b.cov[market]
	if c == nil {
		c = &coverage{first: ts, since: ts}
		b.cov[market] = c
	}
	if c.end != 0 {
		return
	}
	if c.ok && !ok {
		c.clean += ts - c.since
	}
	if !c.ok && ok {
		c.since = ts
	}
	c.ok = ok
}

// retire stops counting a market's time from ts on: it closed, so there is nothing left to
// record and its book can never be verified again. Idempotent.
func (b *base) retire(market string, ts int64) {
	c := b.cov[market]
	if c == nil || c.end != 0 {
		return
	}
	if c.ok {
		c.clean += ts - c.since
		c.ok = false
	}
	c.end = ts
}

// seenMarket registers a market (not yet clean) so its time counts toward coverage.
func (b *base) seenMarket(market string, ts int64) {
	if b.cov[market] == nil {
		b.setClean(market, ts, false)
	}
}

// allDirty marks every market stale (disconnect or restart).
func (b *base) allDirty(ts int64) {
	for m := range b.cov {
		b.setClean(m, ts, false)
	}
}

func (b *base) next(marketID string) uint64 {
	b.seq[marketID]++
	return b.seq[marketID]
}

// status maps a tap status record to an md.Status. It reports whether the record means
// books may have missed updates (disconnect or restart).
func (b *base) status(r rawlog.Record) (*md.Status, bool) {
	var s struct{ State, Detail string }
	if err := json.Unmarshal(r.Msg, &s); err != nil {
		b.stats.ParseErrors++
		return nil, false
	}
	out := &md.Status{V: 1, Venue: b.venue, Ts: r.RecvNs, Detail: s.Detail}
	gap := false
	switch s.State {
	case "connected":
		out.State = md.Connected
	case "disconnected":
		out.State, gap = md.Disconnected, true
	case "start":
		out.State, gap = md.Info, true
		out.Detail = "recorder start: " + s.Detail
	case "resubscribe":
		// The tap replaces every connection without per-connection disconnect records.
		out.State, gap = md.Info, true
		out.Detail = "resubscribe: " + s.Detail
	default:
		out.State = md.Info
		out.Detail = s.State + ": " + s.Detail
	}
	if gap {
		b.stats.Gaps++
	}
	return out, gap
}

func (b *base) gapStatus(ts int64, marketID, detail string) *md.Status {
	return &md.Status{V: 1, Venue: b.venue, Ts: ts, State: md.Gap, MarketID: &marketID, Detail: detail}
}

func ptr[T any](v T) *T { return &v }

// levels converts decimal-string levels into a book side, or reports a parse error.
func setLevels(bk *book.Book, side book.Side, lv [][2]string) error {
	for _, l := range lv {
		px, err := fixed.Parse(l[0])
		if err != nil {
			return err
		}
		sz, err := fixed.Parse(l[1])
		if err != nil {
			return err
		}
		bk.Set(side, px, sz)
	}
	return nil
}

// recent remembers the last n keys, to drop messages delivered twice (e.g. on two connections).
type recent struct {
	n    int
	set  map[string]struct{}
	fifo []string
}

func newRecent(n int) *recent { return &recent{n: n, set: make(map[string]struct{}, n)} }

// seen reports whether key was already recorded, and records it.
func (r *recent) seen(key string) bool {
	if _, ok := r.set[key]; ok {
		return true
	}
	r.set[key] = struct{}{}
	r.fifo = append(r.fifo, key)
	if len(r.fifo) > r.n {
		delete(r.set, r.fifo[0])
		r.fifo = r.fifo[1:]
	}
	return false
}
