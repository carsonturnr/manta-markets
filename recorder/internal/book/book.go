// Package book is an L2 order book keyed by exact fixed-point prices (internal/fixed).
package book

import (
	"maps"
	"slices"
)

// Side of the book.
type Side int

const (
	Bid Side = iota
	Ask
)

// Level is a price level in fixed-point units.
type Level struct{ Px, Sz int64 }

// Book holds aggregate size per price level.
type Book struct {
	bids, asks map[int64]int64
}

func New() *Book { return &Book{bids: map[int64]int64{}, asks: map[int64]int64{}} }

func (b *Book) side(s Side) map[int64]int64 {
	if s == Bid {
		return b.bids
	}
	return b.asks
}

// Set replaces a level's size; size 0 deletes it.
func (b *Book) Set(s Side, px, sz int64) {
	if sz == 0 {
		delete(b.side(s), px)
		return
	}
	b.side(s)[px] = sz
}

// Reset clears both sides (before applying a snapshot).
func (b *Book) Reset() {
	clear(b.bids)
	clear(b.asks)
}

// Best returns the best price on a side (highest bid, lowest ask).
func (b *Book) Best(s Side) (int64, bool) {
	m := b.side(s)
	if len(m) == 0 {
		return 0, false
	}
	keys := maps.Keys(m)
	if s == Bid {
		return slices.Max(slices.Collect(keys)), true
	}
	return slices.Min(slices.Collect(keys)), true
}

// Levels returns a side best-first.
func (b *Book) Levels(s Side) []Level {
	m := b.side(s)
	out := make([]Level, 0, len(m))
	for px, sz := range m {
		out = append(out, Level{px, sz})
	}
	slices.SortFunc(out, func(x, y Level) int {
		if s == Bid {
			return cmpInt(y.Px, x.Px)
		}
		return cmpInt(x.Px, y.Px)
	})
	return out
}

// Equal reports whether both books hold identical levels.
func (b *Book) Equal(o *Book) bool {
	return maps.Equal(b.bids, o.bids) && maps.Equal(b.asks, o.asks)
}

// Diff describes the first few differing levels, for mismatch reports.
func (b *Book) Diff(o *Book, limit int) []string {
	var out []string
	for _, s := range []Side{Bid, Ask} {
		name := map[Side]string{Bid: "bid", Ask: "ask"}[s]
		pxs := slices.Sorted(maps.Keys(b.side(s)))
		pxs = append(pxs, slices.Sorted(maps.Keys(o.side(s)))...)
		slices.Sort(pxs)
		for _, px := range slices.Compact(pxs) {
			if x, y := b.side(s)[px], o.side(s)[px]; x != y {
				out = append(out, formatDiff(name, px, x, y))
				if len(out) >= limit {
					return out
				}
			}
		}
	}
	return out
}

func cmpInt(a, b int64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// Get returns a level's size (0 when absent).
func (b *Book) Get(s Side, px int64) int64 { return b.side(s)[px] }

// Clone returns an independent copy.
func (b *Book) Clone() *Book {
	return &Book{bids: maps.Clone(b.bids), asks: maps.Clone(b.asks)}
}
