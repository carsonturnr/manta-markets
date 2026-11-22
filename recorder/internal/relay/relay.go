// Package relay keeps every recorded Kalshi market's book and latest trades in memory, from the
// recorder's own writes (rawlog.Writer.OnWrite), and pushes them to subscribers as they change:
// the live order books of the site's terminal, without polling Kalshi or the database.
//
// One goroutine (Run) owns all state, so there are no locks: records, subscribers joining and
// leaving, and the push timer all arrive on channels. Books are rebuilt by the same normalizer
// the replay uses (internal/normalize), so live and replayed books agree.
//
// Changes are coalesced: a market changing 50 times in a quarter second is pushed once, with its
// state at the end. Kalshi sends ~7,000 book updates a second across all markets (26 million an
// hour, decisions.md 2026-11-17); a browser needs a few of them a few times a second.
package relay

import (
	"encoding/json"
	"log"
	"sync/atomic"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/normalize"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

const (
	Levels    = 10 // book levels pushed per side
	MaxTrades = 20 // latest trades kept and pushed per market
	inBuffer  = 1 << 16
	outBuffer = 64 // pushes queued per subscriber before it counts as too slow and is dropped
)

// Update is what a subscriber receives for one market: its whole current state, so the client
// just replaces what it had (no merging, and a missed push is harmless).
type Update struct {
	Ticker string `json:"ticker"`
	// Live is false while the book may have missed an update (after a disconnect or a sequence
	// gap) until Kalshi's next full snapshot; Bids and Asks are then empty. A book we know may
	// be wrong is never shown.
	Live   bool           `json:"live"`
	T      int64          `json:"t"`    // unix ms of the last change we received
	Bids   [][2]float64   `json:"bids"` // [price $, size contracts], best first
	Asks   [][2]float64   `json:"asks"` // YES asks (a NO bid at p is a YES ask at 1 − p)
	Trades []replay.Trade `json:"trades"`
}

type market struct {
	book   *book.Book
	live   bool
	t      int64
	trades []replay.Trade // newest first
}

type client struct {
	tickers []string
	ch      chan []byte
}

// Hub is the relay. Create with New, feed with Write, start with Run.
type Hub struct {
	in      chan rawlog.Record
	join    chan *client
	leave   chan *client
	done    chan struct{} // closed when Run returns
	every   time.Duration
	norm    normalize.Normalizer
	markets map[string]*market
	dirty   map[string]bool
	subs    map[string]map[*client]bool // by ticker
	clients map[*client]bool

	// Counters for /health, read from other goroutines.
	Records, Dropped, Slow atomic.Uint64
	Markets, Clients       atomic.Int64
}

// New returns a hub that pushes changes at most once per `every` per market.
func New(every time.Duration) *Hub {
	n, _ := normalize.New("kalshi")
	return &Hub{in: make(chan rawlog.Record, inBuffer), join: make(chan *client),
		leave: make(chan *client), done: make(chan struct{}), every: every, norm: n,
		markets: map[string]*market{}, dirty: map[string]bool{},
		subs: map[string]map[*client]bool{}, clients: map[*client]bool{}}
}

// Write is the rawlog.Writer.OnWrite hook. It runs under the writer's lock, so it never blocks:
// when the buffer is full the record is dropped and counted. A dropped book update can't leave a
// wrong book on screen: Kalshi numbers each update, the normalizer sees the skipped number, and
// every book goes not-live until the next snapshot.
func (h *Hub) Write(r rawlog.Record) {
	if r.Venue != "kalshi" {
		return
	}
	select {
	case h.in <- r:
	default:
		h.Dropped.Add(1)
	}
}

// Run applies records and pushes changes until stop is closed. A panic here stops the relay
// but not the recorder (Write just starts dropping): recording matters more than the relay.
func (h *Hub) Run(stop <-chan struct{}) {
	defer close(h.done)
	defer func() {
		if p := recover(); p != nil {
			log.Printf("relay stopped: %v", p)
		}
	}()
	tick := time.NewTicker(h.every)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case r := <-h.in:
			h.handle(r)
		case c := <-h.join:
			h.add(c)
		case c := <-h.leave:
			h.drop(c)
		case <-tick.C:
			h.flush()
		}
	}
}

func (h *Hub) handle(r rawlog.Record) {
	h.Records.Add(1)
	if r.Stream == "subscribe" { // a new connection: every book waits for its new snapshot
		h.allStale(r.RecvNs)
	}
	for _, m := range h.norm.Handle(r) {
		h.apply(m)
	}
	h.Markets.Store(int64(len(h.markets)))
}

func (h *Hub) market(id string) *market {
	m := h.markets[id]
	if m == nil {
		m = &market{book: book.New(), trades: []replay.Trade{}}
		h.markets[id] = m
	}
	return m
}

func (h *Hub) apply(msg md.Msg) {
	switch msg := msg.(type) {
	case *md.Book:
		m := h.market(msg.MarketID)
		if msg.Kind == md.Snapshot {
			m.book.Reset()
			m.live = true
		}
		replay.Apply(m.book, book.Bid, msg.Bids)
		replay.Apply(m.book, book.Ask, msg.Asks)
		m.t = msg.RecvTs / 1e6
		h.dirty[msg.MarketID] = true
	case *md.Trade:
		m := h.market(msg.MarketID)
		t := msg.RecvTs / 1e6
		if msg.VenueTsMs != nil {
			t = *msg.VenueTsMs
		}
		m.trades = append([]replay.Trade{{T: t, Side: msg.Side, Px: num(msg.Px), Sz: num(msg.Sz)}},
			m.trades[:min(len(m.trades), MaxTrades-1)]...)
		m.t = msg.RecvTs / 1e6
		h.dirty[msg.MarketID] = true
	case *md.Status:
		switch {
		case msg.State == md.Gap && msg.MarketID != nil:
			if m := h.markets[*msg.MarketID]; m != nil {
				m.live = false
				h.dirty[*msg.MarketID] = true
			}
		case msg.State == md.Gap || msg.State == md.Disconnected:
			h.allStale(msg.Ts)
		}
	}
}

func (h *Hub) allStale(ts int64) {
	for id, m := range h.markets {
		if m.live {
			m.live, m.t = false, ts/1e6
			h.dirty[id] = true
		}
	}
}

func (h *Hub) update(id string) []byte {
	m := h.markets[id]
	u := Update{Ticker: id, Bids: [][2]float64{}, Asks: [][2]float64{}, Trades: []replay.Trade{}}
	if m != nil {
		u.Live, u.T, u.Trades = m.live, m.t, m.trades
		if m.live {
			u.Bids, u.Asks = replay.Top(m.book, book.Bid, Levels), replay.Top(m.book, book.Ask, Levels)
		}
	}
	b, _ := json.Marshal(u)
	return b
}

// flush pushes each changed market once to its subscribers. The JSON is built once per market,
// not once per subscriber, and only for markets someone is watching.
func (h *Hub) flush() {
	for id := range h.dirty {
		if len(h.subs[id]) == 0 {
			continue
		}
		msg := h.update(id)
		for c := range h.subs[id] {
			h.send(c, msg)
		}
	}
	clear(h.dirty)
}

// send queues a push, or drops a client that has fallen outBuffer pushes behind (it reconnects
// and starts from the current state).
func (h *Hub) send(c *client, msg []byte) {
	if !h.clients[c] {
		return
	}
	select {
	case c.ch <- msg:
	default:
		h.Slow.Add(1)
		h.drop(c)
	}
}

// add registers a client and sends it the current state of each of its markets at once.
func (h *Hub) add(c *client) {
	h.clients[c] = true
	h.Clients.Store(int64(len(h.clients)))
	for _, id := range c.tickers {
		if h.subs[id] == nil {
			h.subs[id] = map[*client]bool{}
		}
		h.subs[id][c] = true
		h.send(c, h.update(id))
	}
}

// drop unregisters a client and closes its channel, once.
func (h *Hub) drop(c *client) {
	if !h.clients[c] {
		return
	}
	delete(h.clients, c)
	h.Clients.Store(int64(len(h.clients)))
	for _, id := range c.tickers {
		delete(h.subs[id], c)
		if len(h.subs[id]) == 0 {
			delete(h.subs, id)
		}
	}
	close(c.ch)
}

// num reads a decimal string (the normalizer's output, already validated) as a float.
func num(s string) float64 {
	v, _ := fixed.Parse(s)
	return float64(v) / float64(fixed.Scale)
}
