package normalize

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/book"
	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// A Kalshi book holds bids for YES and bids for NO; a NO bid at p is a YES ask at 1 − p, so
// the published book is the YES side.
//
// Two recording modes, chosen per tap run:
//   - WebSocket (API key; "subscribe" records since 2026-11-03). orderbook_snapshot then
//     orderbook_delta, each with a seq that rises by one per subscription. A skipped seq is a
//     lost update: every book on the connection goes stale until the tap reconnects and new
//     snapshots arrive. A delta that drives a level below zero is a mismatch. REST orderbooks
//     carry no timestamp, so one is compared only when the WebSocket book did not change
//     within kalshiRestWindow on either side of it (otherwise it counts as unaligned). REST is
//     never adopted in this mode: the WebSocket feed is the source.
//   - REST polling (no key). Each poll is the book. Unchanged polls are not republished,
//     except as a heartbeat every 5 minutes.
type kalshi struct {
	base
	ws      bool // the current tap run streams books over the WebSocket
	sids    map[int]uint64
	books   map[string]*kalshiBook
	pending []kalshiRest
	last    map[string]*kalshiLast // polling mode
}

type kalshiBook struct {
	book    *book.Book
	dirty   bool
	changed int64 // recv_ns of the latest WebSocket change
}

type kalshiRest struct {
	ticker string
	recv   int64
	book   *book.Book
}

type kalshiLast struct {
	book *book.Book
	at   int64
}

const (
	kalshiHeartbeat  = int64(5 * time.Minute)
	kalshiRestWindow = int64(2 * time.Second)
)

func newKalshi() *kalshi {
	return &kalshi{base: newBase("kalshi"), sids: map[int]uint64{}, books: map[string]*kalshiBook{},
		last: map[string]*kalshiLast{}}
}

func (k *kalshi) Handle(r rawlog.Record) []md.Msg {
	k.stats.Records++
	k.tick(r.RecvNs)
	out := k.runPending(r.RecvNs)
	switch r.Stream {
	case "status":
		s, gap := k.status(r)
		if s != nil {
			out = append(out, s)
			// A failed poll ("poll_error: TICKER: error") leaves that market stale until the next.
			if rest, ok := strings.CutPrefix(s.Detail, "poll_error: "); ok && !k.ws {
				ticker, _, _ := strings.Cut(rest, ":")
				k.setClean(ticker, r.RecvNs, false)
			}
			if strings.HasPrefix(s.Detail, "recorder start: ") {
				k.ws = false
			}
		}
		if gap {
			k.markStale(r.RecvNs)
		}
	case "subscribe": // a new WebSocket connection: seq restarts, snapshots follow
		k.ws = true
		k.sids = map[int]uint64{}
		k.markStale(r.RecvNs)
	case "ws":
		out = append(out, k.wsMsg(r)...)
	case "orderbook":
		if k.ws {
			out = append(out, k.restCheck(r)...)
		} else {
			out = append(out, k.orderbook(r)...)
		}
	default: // markets
		k.stats.Ignored++
	}
	k.stats.Msgs += uint64(len(out))
	return out
}

func (k *kalshi) markStale(ts int64) {
	for _, b := range k.books {
		b.dirty = true
	}
	k.pending = nil
	k.allDirty(ts)
}

// yesBook builds the YES-side book from Kalshi's YES and NO bid ladders.
func yesBook(yes, no [][2]string) (*book.Book, error) {
	b := book.New()
	if err := setLevels(b, book.Bid, yes); err != nil {
		return nil, err
	}
	for _, l := range no {
		px, err := fixed.Parse(l[0])
		if err != nil {
			return nil, err
		}
		sz, err := fixed.Parse(l[1])
		if err != nil {
			return nil, err
		}
		b.Set(book.Ask, fixed.Scale-px, sz)
	}
	return b, nil
}

func (k *kalshi) wsMsg(r rawlog.Record) []md.Msg {
	var m struct {
		Type string          `json:"type"`
		Sid  int             `json:"sid"`
		Seq  uint64          `json:"seq"`
		Msg  json.RawMessage `json:"msg"`
	}
	if json.Unmarshal(r.Msg, &m) != nil {
		k.stats.ParseErrors++
		return nil
	}
	var out []md.Msg
	if m.Seq > 0 {
		prev, ok := k.sids[m.Sid]
		k.sids[m.Sid] = m.Seq
		if ok && m.Seq != prev+1 {
			k.stats.Gaps++
			k.markStale(r.RecvNs)
			out = append(out, &md.Status{V: 1, Venue: "kalshi", Ts: r.RecvNs, State: md.Gap,
				Detail: "seq gap"})
		}
	}
	switch m.Type {
	case "orderbook_snapshot":
		return append(out, k.wsSnapshot(r.RecvNs, m.Seq, m.Msg)...)
	case "orderbook_delta":
		return append(out, k.wsDelta(r.RecvNs, m.Seq, m.Msg)...)
	case "trade":
		return append(out, k.trade(r.RecvNs, m.Msg)...)
	case "error":
		return append(out, &md.Status{V: 1, Venue: "kalshi", Ts: r.RecvNs, State: md.Info,
			Detail: "venue error: " + string(m.Msg)})
	default: // subscribed, ok
		k.stats.Ignored++
		return out
	}
}

func (k *kalshi) wsSnapshot(recv int64, seq uint64, raw json.RawMessage) []md.Msg {
	var m struct {
		Ticker string      `json:"market_ticker"`
		Yes    [][2]string `json:"yes_dollars_fp"`
		No     [][2]string `json:"no_dollars_fp"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Ticker == "" {
		k.stats.ParseErrors++
		return nil
	}
	b, err := yesBook(m.Yes, m.No)
	if err != nil {
		k.stats.ParseErrors++
		return nil
	}
	if st := k.books[m.Ticker]; st != nil && !st.dirty {
		k.stats.WSSnapCompares++
		if !st.book.Equal(b) {
			k.stats.WSSnapMismatches++
			k.stats.example("kalshi %s ws-snapshot: %v", m.Ticker, st.book.Diff(b, 4))
		}
	}
	k.books[m.Ticker] = &kalshiBook{book: b, changed: recv}
	k.setClean(m.Ticker, recv, true)
	return []md.Msg{&md.Book{V: 1, Venue: "kalshi", MarketID: m.Ticker, Rseq: k.next(m.Ticker),
		VenueSeq: ptr(seq), RecvTs: recv, Kind: md.Snapshot, Bids: b.Strings(book.Bid),
		Asks: b.Strings(book.Ask), Source: "ws"}}
}

func (k *kalshi) wsDelta(recv int64, seq uint64, raw json.RawMessage) []md.Msg {
	var m struct {
		Ticker string `json:"market_ticker"`
		Price  string `json:"price_dollars"`
		Delta  string `json:"delta_fp"`
		Side   string `json:"side"`
		TsMs   int64  `json:"ts_ms"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Ticker == "" {
		k.stats.ParseErrors++
		return nil
	}
	px, err1 := fixed.Parse(m.Price)
	d, err2 := fixed.Parse(m.Delta)
	if err1 != nil || err2 != nil || (m.Side != "yes" && m.Side != "no") {
		k.stats.ParseErrors++
		return nil
	}
	st := k.books[m.Ticker]
	if st == nil { // no snapshot yet: nothing to rebuild against
		k.stats.Ignored++
		return nil
	}
	side := book.Bid
	if m.Side == "no" {
		side, px = book.Ask, fixed.Scale-px
	}
	sz := st.book.Get(side, px) + d
	st.changed = recv
	var out []md.Msg
	switch {
	case sz >= 0 && !st.dirty:
		k.stats.DeltaChecks++
	case sz >= 0:
	case st.dirty:
		k.stats.AfterGapMismatches++
		sz = 0
	default:
		k.stats.DeltaMismatches++
		k.stats.example("kalshi %s seq %d: %s %s by %s goes below zero", m.Ticker, seq, m.Side, m.Price, m.Delta)
		st.dirty = true
		k.setClean(m.Ticker, recv, false)
		out = append(out, k.gapStatus(recv, m.Ticker, "delta below zero"))
		sz = 0
	}
	st.book.Set(side, px, sz)
	lv := [][2]string{{fixed.Format(px), fixed.Format(sz)}}
	b := &md.Book{V: 1, Venue: "kalshi", MarketID: m.Ticker, Rseq: k.next(m.Ticker), VenueSeq: ptr(seq),
		RecvTs: recv, Kind: md.Delta, Bids: [][2]string{}, Asks: [][2]string{}, Source: "ws"}
	if m.TsMs > 0 {
		b.VenueTsMs = ptr(m.TsMs)
	}
	if side == book.Bid {
		b.Bids = lv
	} else {
		b.Asks = lv
	}
	return append(out, b)
}

func (k *kalshi) trade(recv int64, raw json.RawMessage) []md.Msg {
	var m struct {
		TradeID   string `json:"trade_id"`
		Ticker    string `json:"market_ticker"`
		AltTicker string `json:"ticker"` // REST trades' name for it
		YesPrice  string `json:"yes_price_dollars"`
		Count     string `json:"count_fp"`
		TakerSide string `json:"taker_side"`
		Ts        int64  `json:"ts"` // seconds
		TsMs      int64  `json:"ts_ms"`
	}
	if json.Unmarshal(raw, &m) != nil {
		k.stats.ParseErrors++
		return nil
	}
	if m.Ticker == "" {
		m.Ticker = m.AltTicker
	}
	px, err1 := fixed.Parse(m.YesPrice)
	sz, err2 := fixed.Parse(m.Count)
	if err1 != nil || err2 != nil || m.Ticker == "" {
		k.stats.ParseErrors++
		return nil
	}
	side := "unknown" // in YES terms: a taker buying NO sells YES
	switch m.TakerSide {
	case "yes":
		side = "buy"
	case "no":
		side = "sell"
	}
	t := &md.Trade{V: 1, Venue: "kalshi", MarketID: m.Ticker, Rseq: k.next(m.Ticker), RecvTs: recv,
		Side: side, Px: fixed.Format(px), Sz: fixed.Format(sz)}
	if m.TradeID != "" {
		t.TradeID = ptr(m.TradeID)
	}
	switch {
	case m.TsMs > 0:
		t.VenueTsMs = ptr(m.TsMs)
	case m.Ts > 0:
		t.VenueTsMs = ptr(m.Ts * 1000)
	}
	return []md.Msg{t}
}

type kalshiRESTBook struct {
	Ticker string `json:"ticker"`
	Book   struct {
		OrderbookFP struct {
			Yes [][2]string `json:"yes_dollars"`
			No  [][2]string `json:"no_dollars"`
		} `json:"orderbook_fp"`
	} `json:"book"`
}

func parseRESTBook(raw json.RawMessage) (string, *book.Book, bool) {
	var m kalshiRESTBook
	if json.Unmarshal(raw, &m) != nil || m.Ticker == "" {
		return "", nil, false
	}
	b, err := yesBook(m.Book.OrderbookFP.Yes, m.Book.OrderbookFP.No)
	return m.Ticker, b, err == nil
}

// restCheck queues a REST orderbook for comparison once kalshiRestWindow has passed.
func (k *kalshi) restCheck(r rawlog.Record) []md.Msg {
	ticker, b, ok := parseRESTBook(r.Msg)
	if !ok {
		k.stats.ParseErrors++
		return nil
	}
	if st := k.books[ticker]; st != nil && !st.dirty {
		k.pending = append(k.pending, kalshiRest{ticker: ticker, recv: r.RecvNs, book: b})
	}
	return nil
}

// runPending compares queued REST books whose window has passed. It runs before each record
// is applied, so a book unchanged within the window still holds its state as of the REST read.
func (k *kalshi) runPending(now int64) []md.Msg {
	var out []md.Msg
	i := 0
	for ; i < len(k.pending) && k.pending[i].recv+kalshiRestWindow < now; i++ {
		p := k.pending[i]
		st := k.books[p.ticker]
		switch {
		case st == nil || st.dirty:
		case st.changed >= p.recv-kalshiRestWindow:
			k.stats.RestUnaligned++
		case st.book.Equal(p.book):
			k.stats.RestCompares++
		default:
			k.stats.RestCompares++
			k.stats.RestMismatches++
			k.stats.example("kalshi %s rest: %v", p.ticker, st.book.Diff(p.book, 4))
			out = append(out, &md.Status{V: 1, Venue: "kalshi", Ts: now, State: md.Info,
				MarketID: ptr(p.ticker), Detail: "REST orderbook disagrees with WebSocket book"})
		}
	}
	k.pending = k.pending[i:]
	return out
}

// orderbook handles a polled REST orderbook (polling mode): the poll is the book.
func (k *kalshi) orderbook(r rawlog.Record) []md.Msg {
	ticker, b, ok := parseRESTBook(r.Msg)
	if !ok {
		k.stats.ParseErrors++
		return nil
	}
	k.setClean(ticker, r.RecvNs, true)
	if prev := k.last[ticker]; prev != nil && prev.book.Equal(b) && r.RecvNs-prev.at < kalshiHeartbeat {
		return nil
	}
	k.last[ticker] = &kalshiLast{book: b, at: r.RecvNs}
	return []md.Msg{&md.Book{V: 1, Venue: "kalshi", MarketID: ticker, Rseq: k.next(ticker),
		RecvTs: r.RecvNs, Kind: md.Snapshot, Bids: b.Strings(book.Bid), Asks: b.Strings(book.Ask),
		Source: "rest"}}
}
