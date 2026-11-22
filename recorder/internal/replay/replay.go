// Package replay turns the normalizer's book and trade messages into minute-by-minute history
// for the site's replay (step 8, docs/product.md): at each minute boundary, the top levels of
// every chosen market's book, and the trades of the minute before.
//
// Kalshi sends full books only when the recorder (re)subscribes, 5–6 times an hour, and changes
// in between. An hour is therefore replayed after a warm-up: the previous hour's messages are
// applied but not recorded, so every book has had a snapshot by the time recording starts.
// A market whose book hit a gap (a lost update) is left out until its next snapshot: a replay
// never shows a book we know is wrong.
package replay

import (
	"strings"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
)

const minuteNs = int64(60e9)

// Minute is one market at one minute boundary: its top levels, best-first, as [price, size]
// in dollars and contracts.
type Minute struct {
	T    int64        `json:"t"` // unix ms of the boundary
	Bids [][2]float64 `json:"bids"`
	Asks [][2]float64 `json:"asks"`
}

// Trade is one trade: unix ms, taker side, price in dollars, size in contracts.
type Trade struct {
	T    int64   `json:"t"`
	Side string  `json:"side"`
	Px   float64 `json:"px"`
	Sz   float64 `json:"sz"`
}

// Market is one market's history over the replayed hour.
type Market struct {
	Minutes []Minute `json:"minutes"`
	Trades  []Trade  `json:"trades"`
}

// Builder applies messages in time order and records the markets whose ticker starts with one
// of Prefixes, at each minute boundary in [From, To) (unix ns).
type Builder struct {
	Prefixes []string
	From, To int64
	Levels   int

	books   map[string]*book.Book
	trusted map[string]bool
	next    int64 // the next boundary to record
	Out     map[string]*Market
	Gaps    map[string]int // gap reports for the chosen markets inside the hour, by reason
}

func New(prefixes []string, from, to int64, levels int) *Builder {
	return &Builder{Prefixes: prefixes, From: from, To: to, Levels: levels,
		books: map[string]*book.Book{}, trusted: map[string]bool{}, next: from, Out: map[string]*Market{},
		Gaps: map[string]int{}}
}

func (b *Builder) wanted(id string) bool {
	for _, p := range b.Prefixes {
		if strings.HasPrefix(id, p) {
			return true
		}
	}
	return false
}

// Handle applies one message. Messages must come in time order.
func (b *Builder) Handle(m md.Msg) {
	switch m := m.(type) {
	case *md.Book:
		b.advance(m.RecvTs)
		if m.Source != "ws" || !b.wanted(m.MarketID) {
			return // REST books are the recorder's cross-checks, not part of the stream
		}
		bk := b.books[m.MarketID]
		if bk == nil {
			bk = book.New()
			b.books[m.MarketID] = bk
		}
		if m.Kind == md.Snapshot {
			bk.Reset()
			b.trusted[m.MarketID] = true
		}
		Apply(bk, book.Bid, m.Bids)
		Apply(bk, book.Ask, m.Asks)
	case *md.Trade:
		b.advance(m.RecvTs)
		if !b.wanted(m.MarketID) || m.RecvTs < b.From || m.RecvTs >= b.To {
			return
		}
		t := m.RecvTs / 1e6
		if m.VenueTsMs != nil {
			t = *m.VenueTsMs
		}
		b.market(m.MarketID).Trades = append(b.market(m.MarketID).Trades,
			Trade{T: t, Side: m.Side, Px: num(m.Px), Sz: num(m.Sz)})
	case *md.Status:
		b.advance(m.Ts)
		if m.State == md.Gap && m.MarketID != nil && b.wanted(*m.MarketID) {
			b.trusted[*m.MarketID] = false // until the next snapshot
			if m.Ts >= b.From && m.Ts < b.To {
				b.Gaps[m.Detail]++
			}
		}
	}
}

// Finish records any boundaries left before To (the hour ended with no later message).
func (b *Builder) Finish() { b.advance(b.To) }

// advance records every boundary up to and including ts, with the books as they stood just
// before it: a message at 12:00:00.3 is applied after the 12:00 boundary is recorded.
func (b *Builder) advance(ts int64) {
	for b.next < b.To && b.next <= ts {
		for id, bk := range b.books {
			if !b.trusted[id] {
				continue
			}
			if _, ok := bk.Best(book.Bid); !ok {
				if _, ok := bk.Best(book.Ask); !ok {
					continue // cleared: Kalshi empties a book at its close
				}
			}
			b.market(id).Minutes = append(b.market(id).Minutes, Minute{T: b.next / 1e6,
				Bids: Top(bk, book.Bid, b.Levels), Asks: Top(bk, book.Ask, b.Levels)})
		}
		b.next += minuteNs
	}
}

func (b *Builder) market(id string) *Market {
	m := b.Out[id]
	if m == nil {
		m = &Market{Minutes: []Minute{}, Trades: []Trade{}}
		b.Out[id] = m
	}
	return m
}

// Apply sets decimal-string levels on a book side, skipping any that fail to parse.
func Apply(bk *book.Book, s book.Side, lv [][2]string) {
	for _, l := range lv {
		px, err1 := fixed.Parse(l[0])
		sz, err2 := fixed.Parse(l[1])
		if err1 == nil && err2 == nil {
			bk.Set(s, px, sz)
		}
	}
}

// Top returns a side's best n levels as [price, size] in dollars and contracts.
func Top(bk *book.Book, s book.Side, n int) [][2]float64 {
	lv := bk.Levels(s)
	if len(lv) > n {
		lv = lv[:n]
	}
	out := make([][2]float64, len(lv))
	for i, l := range lv {
		out[i] = [2]float64{float64(l.Px) / float64(fixed.Scale), float64(l.Sz) / float64(fixed.Scale)}
	}
	return out
}

func num(s string) float64 {
	v, err := fixed.Parse(s)
	if err != nil {
		return 0
	}
	return float64(v) / float64(fixed.Scale)
}

// Event is the event a Kalshi market belongs to: its ticker up to the last "-"
// (KXBTCD-26NOV1717-T73749.99 → KXBTCD-26NOV1717).
func Event(ticker string) string {
	if i := strings.LastIndex(ticker, "-"); i > 0 {
		return ticker[:i]
	}
	return ticker
}
