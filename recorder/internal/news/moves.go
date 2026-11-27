package news

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

// Key names an item in file names and URLs: its stated day (UTC), source and a short hash of its
// id (ids are URLs). Same form as an event-response release id: 2026-11-25-fed-press-1a2b3c4d.
func Key(it Item) string {
	h := sha256.Sum256([]byte(it.ID))
	return time.UnixMilli(it.StatedMs).UTC().Format(time.DateOnly) + "-" + it.Source + "-" + hex.EncodeToString(h[:4])
}

// T0 is the moment a move is measured from, and which time it is: the stated time where the
// source's is real, else our receipt time (after which the market may already have reacted).
// A backfill item with no real stated time has neither: ok is false.
func T0(it Item) (t0 int64, kind string, ok bool) {
	switch {
	case it.StatedReal:
		return it.StatedMs, "stated", true
	case !it.Backfill:
		return it.ReceivedMs, "received", true
	}
	return 0, "", false
}

// Release is one line of releases.tsv: a scheduled release event response already measures.
type Release struct {
	ID     string
	T0     int64  // unix ms
	Agency string // who publishes it: "bls", "fed" (ReleaseAgency)
}

// releaseAgencies maps a release id's kind (2026-12-10-cpi → cpi) to its agency.
var releaseAgencies = map[string]string{"cpi": "bls", "payrolls": "bls", "fed": "fed"}

// ReleaseAgency is the agency of a releases.tsv id, "" for a kind not listed.
func ReleaseAgency(id string) string {
	if len(id) < 11 {
		return ""
	}
	return releaseAgencies[id[11:]]
}

// Agency is who publishes a source: its name up to the first "-" (fed-press → fed, bls-cpi → bls).
func Agency(source string) string {
	a, _, _ := strings.Cut(source, "-")
	return a
}

// AtRelease is the release an item belongs to: same agency, and t0 in the 10 minutes from the
// release's minute (the CPI headline received at 8:30:20, the FOMC statement stated 19:00).
// Event response already measures that moment, so the item links there and gets no move of its
// own. Another agency's news in those minutes (a Fed speech just after CPI) keeps its own move.
func AtRelease(source string, t0 int64, releases []Release) (string, bool) {
	for _, r := range releases {
		if r.Agency == Agency(source) && t0 >= r.T0 && t0 < r.T0+10*time.Minute.Milliseconds() {
			return r.ID, true
		}
	}
	return "", false
}

// The move window, in minute boundaries around t0's minute: the move is the mid at +30 minutes
// minus the mid at t0's minute; the baseline is the same contract's move over the 30 minutes
// before, because short-dated contracts drift all the time (on a quiet auction, 2026-11-25
// 16:30 UTC, 411 of 715 contracts moved 1¢ or more in the 30 minutes after).
const (
	ChartBefore = 30 * time.Minute
	MoveAfter   = 30 * time.Minute
	// Charted is how many of the biggest movers keep their chart line (the release page's 24).
	Charted = 24
)

// Window is the first and last minute boundary a move reads, unix ms.
func Window(t0 int64) (from, to int64) {
	m := t0 - t0%time.Minute.Milliseconds() // the boundary at or just before t0
	return m - ChartBefore.Milliseconds(), m + MoveAfter.Milliseconds()
}

// Move is one contract's mid around an item, from the hourly replay files' minute boundaries.
type Move struct {
	Ticker    string   `json:"ticker"`
	Event     string   `json:"event"`
	MoveCents *float64 `json:"move_cents"` // null: no two-sided book at one of the two minutes
	// BeforeCents is the baseline: the move over the 30 minutes before t0's minute.
	BeforeCents *float64     `json:"before_cents"`
	Mids        [][2]float64 `json:"mids,omitempty"`
	abs         float64
}

// mid is a minute's midpoint in cents, if both sides have a price.
func mid(m replay.Minute) (float64, bool) {
	if len(m.Bids) == 0 || len(m.Asks) == 0 {
		return 0, false
	}
	return (m.Bids[0][0] + m.Asks[0][0]) * 50, true // dollars → cents, halved
}

// Moves computes each contract's move around t0 from its replay minutes (any order, any hours),
// biggest first; contracts with no mid in the window are left out. Only the Charted biggest
// movers that moved 1¢ or more (Kalshi's smallest step) keep their chart line.
func Moves(t0 int64, minutes map[string][]replay.Minute) []Move {
	from, to := Window(t0)
	start := to - MoveAfter.Milliseconds()
	var out []Move
	for ticker, ms := range minutes {
		var mids [][2]float64
		var first, before, after *float64
		for _, m := range ms {
			v, ok := mid(m)
			if !ok || m.T < from || m.T > to {
				continue
			}
			v = math.Round(v*100) / 100
			mids = append(mids, [2]float64{float64(m.T), v})
			switch m.T {
			case from:
				first = &v
			case start:
				before = &v
			case to:
				after = &v
			}
		}
		if len(mids) == 0 {
			continue
		}
		slices.SortFunc(mids, func(a, b [2]float64) int { return cmp.Compare(a[0], b[0]) })
		mv := Move{Ticker: ticker, Event: replay.Event(ticker), abs: -1}
		if before != nil && after != nil {
			d := math.Round((*after-*before)*100) / 100
			mv.MoveCents, mv.abs = &d, math.Abs(d)
		}
		if first != nil && before != nil {
			d := math.Round((*before-*first)*100) / 100
			mv.BeforeCents = &d
		}
		mv.Mids = mids
		out = append(out, mv)
	}
	slices.SortFunc(out, func(a, b Move) int {
		return cmp.Or(cmp.Compare(b.abs, a.abs), strings.Compare(a.Ticker, b.Ticker))
	})
	for i := range out {
		if i >= Charted || out[i].abs < 1 {
			out[i].Mids = nil
		}
	}
	return out
}
