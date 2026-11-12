package normalize

import (
	"github.com/carsonturnr/manta-markets/recorder/internal/md"
	"github.com/carsonturnr/manta-markets/recorder/internal/rawlog"
)

// feed covers venues recorded as a stream of quotes with no book to rebuild (Deribit, Coinbase,
// Kraken). Coverage is connected time: the feed is clean from its first message after a
// (re)connect until the next disconnect or recorder start. It produces no md messages yet;
// parsing quotes is the pricing engine's job (Milestone 2).
type feed struct{ base }

func (f *feed) Handle(r rawlog.Record) []md.Msg {
	f.stats.Records++
	f.tick(r.RecvNs)
	switch r.Stream {
	case "status":
		s, gap := f.status(r)
		if gap {
			f.allDirty(r.RecvNs)
			f.seenMarket(f.venue, r.RecvNs)
		}
		if s != nil {
			return []md.Msg{s}
		}
	case "ws":
		f.setClean(f.venue, r.RecvNs, true)
	default: // subscribe, instruments
		f.stats.Ignored++
	}
	return nil
}
