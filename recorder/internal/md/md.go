// Package md defines the normalized md.v1 messages published to NATS (docs/schema.md).
package md

import (
	"fmt"
	"strings"
)

// Msg is any md.v1 message.
type Msg interface {
	Subject() string
}

// subjectToken replaces characters NATS reserves in subject tokens with '_'.
var subjectToken = strings.NewReplacer(".", "_", "*", "_", ">", "_", " ", "_", "\t", "_")

func subject(venue, marketID, kind string) string {
	return fmt.Sprintf("md.v1.%s.%s.%s", venue, subjectToken.Replace(marketID), kind)
}

// Book kinds.
const (
	Snapshot = "snapshot"
	Delta    = "delta"
)

// Book is an L2 snapshot or delta. Prices and sizes are decimal strings.
type Book struct {
	V         int         `json:"v"`
	Venue     string      `json:"venue"`
	MarketID  string      `json:"market_id"`
	Rseq      uint64      `json:"rseq"`
	VenueSeq  *uint64     `json:"venue_seq"`
	RecvTs    int64       `json:"recv_ts"`
	VenueTsMs *int64      `json:"venue_ts_ms"`
	Kind      string      `json:"kind"`
	Bids      [][2]string `json:"bids"`
	Asks      [][2]string `json:"asks"`
	BookHash  *string     `json:"book_hash"`
	Source    string      `json:"source"` // "ws" or "rest"
}

func (m *Book) Subject() string { return subject(m.Venue, m.MarketID, "book") }

// Trade is one venue trade.
type Trade struct {
	V         int     `json:"v"`
	Venue     string  `json:"venue"`
	MarketID  string  `json:"market_id"`
	Rseq      uint64  `json:"rseq"`
	TradeID   *string `json:"trade_id"`
	RecvTs    int64   `json:"recv_ts"`
	VenueTsMs *int64  `json:"venue_ts_ms"`
	Side      string  `json:"side"` // buy | sell | unknown (taker side)
	Px        string  `json:"px"`
	Sz        string  `json:"sz"`
}

func (m *Trade) Subject() string { return subject(m.Venue, m.MarketID, "trade") }

// Ctx is a perp's venue-reported context (Hyperliquid activeAssetCtx).
type Ctx struct {
	V            int    `json:"v"`
	Venue        string `json:"venue"`
	MarketID     string `json:"market_id"`
	Rseq         uint64 `json:"rseq"`
	RecvTs       int64  `json:"recv_ts"`
	MarkPx       string `json:"mark_px"`
	OraclePx     string `json:"oracle_px"`
	MidPx        string `json:"mid_px"`
	Funding      string `json:"funding"`
	OpenInterest string `json:"open_interest"`
	DayNtlVlm    string `json:"day_ntl_vlm"`
}

func (m *Ctx) Subject() string { return subject(m.Venue, m.MarketID, "ctx") }

// Status states.
const (
	Connected    = "connected"
	Gap          = "gap"
	Resync       = "resync"
	Disconnected = "disconnected"
	Info         = "info"
)

// Status is a recorder health event for a venue (MarketID set when it concerns one market).
type Status struct {
	V        int     `json:"v"`
	Venue    string  `json:"venue"`
	Ts       int64   `json:"ts"`
	State    string  `json:"state"`
	MarketID *string `json:"market_id"`
	Detail   string  `json:"detail"`
}

func (m *Status) Subject() string { return fmt.Sprintf("md.v1.%s.status", m.Venue) }
