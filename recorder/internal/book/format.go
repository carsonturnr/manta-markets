package book

import (
	"fmt"

	"github.com/carsonturnr/manta-markets/recorder/internal/fixed"
)

func formatDiff(side string, px, got, want int64) string {
	return fmt.Sprintf("%s %s: %s vs %s", side, fixed.Format(px), fixed.Format(got), fixed.Format(want))
}

// Strings renders a side best-first as [px, sz] decimal strings (docs/schema.md book message).
func (b *Book) Strings(s Side) [][2]string {
	lv := b.Levels(s)
	out := make([][2]string, len(lv))
	for i, l := range lv {
		out[i] = [2]string{fixed.Format(l.Px), fixed.Format(l.Sz)}
	}
	return out
}
