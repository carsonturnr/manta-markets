package relay

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
	"github.com/carsonturnr/manta-markets/recorder/internal/replay"
)

const ms = int64(1e6)

func ws(ns int64, typ string, seq int, msg string) rawlog.Record {
	return rawlog.Record{RecvNs: ns, Venue: "kalshi", Stream: "ws",
		Msg: json.RawMessage(fmt.Sprintf(`{"type":%q,"sid":1,"seq":%d,"msg":%s}`, typ, seq, msg))}
}

// KX-1: YES bids 0.30×10 and 0.29×5; a NO bid at 0.65×4 is a YES ask at 0.35×4.
func snap(ns int64, seq int, ticker string) rawlog.Record {
	return ws(ns, "orderbook_snapshot", seq, `{"market_ticker":"`+ticker+`","yes_dollars_fp":[["0.3000","10.00"],["0.2900","5.00"]],"no_dollars_fp":[["0.6500","4.00"]]}`)
}

func delta(ns int64, seq int, px, d, side string) rawlog.Record {
	return ws(ns, "orderbook_delta", seq, `{"market_ticker":"KX-1","price_dollars":"`+px+`","delta_fp":"`+d+`","side":"`+side+`"}`)
}

func trade(ns int64, seq int, px string) rawlog.Record {
	return ws(ns, "trade", seq, `{"market_ticker":"KX-1","yes_price_dollars":"`+px+`","count_fp":"2.00","taker_side":"no","ts_ms":`+fmt.Sprint(ns/ms)+`}`)
}

func newClient(h *Hub, tickers ...string) *client {
	c := &client{tickers: tickers, ch: make(chan []byte, outBuffer)}
	h.add(c)
	return c
}

// recv returns the updates queued for a client.
func recv(t *testing.T, c *client) []Update {
	t.Helper()
	var out []Update
	for {
		select {
		case b, ok := <-c.ch:
			if !ok {
				return out
			}
			var u Update
			if err := json.Unmarshal(b, &u); err != nil {
				t.Fatal(err)
			}
			out = append(out, u)
		default:
			return out
		}
	}
}

func TestChangesAreCoalescedIntoOnePushOfTheCurrentBook(t *testing.T) {
	h := New(time.Second)
	c := newClient(h, "KX-1")
	if u := recv(t, c); len(u) != 1 || u[0].Live { // the current state on joining: nothing yet
		t.Fatalf("initial %+v", u)
	}
	h.handle(snap(1*ms, 1, "KX-1"))
	h.handle(snap(1*ms, 2, "KX-2"))                   // not subscribed
	h.handle(delta(2*ms, 3, "0.3100", "3.00", "yes")) // new best bid
	h.handle(delta(3*ms, 4, "0.6500", "-4.00", "no")) // the only ask is taken out
	h.handle(delta(4*ms, 5, "0.6700", "1.00", "no"))  // a YES ask at 0.33
	h.flush()
	got := recv(t, c)
	want := []Update{{Ticker: "KX-1", Live: true, T: 4,
		Bids: [][2]float64{{0.31, 3}, {0.30, 10}, {0.29, 5}}, Asks: [][2]float64{{0.33, 1}},
		Trades: []replay.Trade{}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
	h.flush() // nothing changed: nothing pushed
	if u := recv(t, c); len(u) != 0 {
		t.Fatalf("pushed without a change: %+v", u)
	}
}

func TestASeqGapHidesTheBookUntilTheNextSnapshot(t *testing.T) {
	h := New(time.Second)
	h.handle(snap(1*ms, 1, "KX-1"))
	c := newClient(h, "KX-1")
	recv(t, c)
	h.handle(delta(2*ms, 3, "0.3100", "3.00", "yes")) // seq 2 was lost
	h.flush()
	if u := recv(t, c); len(u) != 1 || u[0].Live || len(u[0].Bids) != 0 {
		t.Fatalf("after gap %+v", u)
	}
	h.handle(snap(3*ms, 4, "KX-1"))
	h.flush()
	if u := recv(t, c); len(u) != 1 || !u[0].Live || u[0].Bids[0] != [2]float64{0.30, 10} {
		t.Fatalf("after snapshot %+v", u)
	}
}

func TestANewConnectionHidesBooksUntilTheirSnapshots(t *testing.T) {
	h := New(time.Second)
	h.handle(snap(1*ms, 1, "KX-1"))
	h.handle(rawlog.Record{RecvNs: 2 * ms, Venue: "kalshi", Stream: "subscribe", Msg: json.RawMessage(`{}`)})
	c := newClient(h, "KX-1")
	if u := recv(t, c); len(u) != 1 || u[0].Live {
		t.Fatalf("%+v", u)
	}
}

func TestClosedMarketsAreForgottenOnResubscribe(t *testing.T) {
	h := New(time.Second)
	h.handle(snap(1*ms, 1, "KX-1"))
	h.handle(snap(2*ms, 2, "KX-2"))
	frame := `{\"params\":{\"market_tickers\":[\"KX-2\"]}}`
	h.handle(rawlog.Record{RecvNs: 3 * ms, Venue: "kalshi", Stream: "subscribe",
		Msg: json.RawMessage(`{"label":"conn 0 (1 markets)","frames":["` + frame + `"]}`)})
	if h.markets["KX-1"] != nil || h.markets["KX-2"] == nil || h.Markets.Load() != 1 {
		t.Fatalf("markets %v", h.markets)
	}
}

func TestTradesAreNewestFirstAndCapped(t *testing.T) {
	h := New(time.Second)
	for i := range MaxTrades + 5 {
		h.handle(trade(int64(i+1)*ms, i+1, fmt.Sprintf("0.%02d00", i+10)))
	}
	c := newClient(h, "KX-1")
	u := recv(t, c)[0]
	if len(u.Trades) != MaxTrades {
		t.Fatalf("%d trades", len(u.Trades))
	}
	// The last trade was the 25th, at 0.34; taker bought NO, so it sold YES.
	if first := u.Trades[0]; first != (replay.Trade{T: 25, Side: "sell", Px: 0.34, Sz: 2}) {
		t.Fatalf("newest %+v", first)
	}
	if last := u.Trades[MaxTrades-1]; last.T != 6 {
		t.Fatalf("oldest kept %+v", last)
	}
}

func TestASlowClientIsDroppedAndOthersKeepTheirPushes(t *testing.T) {
	h := New(time.Second)
	slow, fast := newClient(h, "KX-1"), newClient(h, "KX-1")
	h.handle(snap(1*ms, 1, "KX-1"))
	for i := range outBuffer + 1 {
		h.handle(delta(int64(i+2)*ms, i+2, "0.2000", "1.00", "yes"))
		h.flush()
		recv(t, fast)
	}
	if h.clients[slow] || len(h.subs["KX-1"]) != 1 {
		t.Fatal("slow client still registered")
	}
	recv(t, slow)
	if _, ok := <-slow.ch; ok {
		t.Fatal("slow client's channel not closed")
	}
	h.drop(slow) // the handler's leave after a drop is harmless
}

func TestWriteNeverBlocks(t *testing.T) {
	h := New(time.Second) // not running: nothing drains the buffer
	h.Write(rawlog.Record{Venue: "deribit"})
	for range inBuffer + 3 {
		h.Write(rawlog.Record{Venue: "kalshi"})
	}
	if d := h.Dropped.Load(); d != 3 {
		t.Fatalf("dropped %d", d)
	}
}

func TestStream(t *testing.T) {
	h := New(10 * time.Millisecond)
	stop := make(chan struct{})
	defer close(stop)
	go h.Run(stop)
	srv := httptest.NewServer(h.Handler("secret"))
	defer srv.Close()

	get := func(path, token string) *http.Response {
		req, _ := http.NewRequest("GET", srv.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	for path, want := range map[string]int{"/stream?tickers=KX-1": 401, "/health": 401} {
		if res := get(path, "wrong"); res.StatusCode != want {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
	if res := get("/stream?tickers=kx-1;drop", "secret"); res.StatusCode != 400 {
		t.Fatalf("bad ticker: %d", res.StatusCode)
	}

	res := get("/stream?tickers=KX-1,KX-1", "secret")
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	h.Write(snap(1*ms, 1, "KX-1"))
	lines := bufio.NewScanner(res.Body)
	var datas []string
	for len(datas) < 2 && lines.Scan() {
		if d, ok := strings.CutPrefix(lines.Text(), "data: "); ok {
			datas = append(datas, d)
		}
	}
	// First the state on joining (no book yet), then the snapshot: once, though asked for twice.
	if len(datas) != 2 || !strings.Contains(datas[0], `"live":false`) ||
		!strings.Contains(datas[1], `"bids":[[0.3,10],[0.29,5]],"asks":[[0.35,4]]`) {
		t.Fatalf("stream %q", datas)
	}
}
