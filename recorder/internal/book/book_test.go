package book

import (
	"slices"
	"testing"
)

func TestSetBestLevels(t *testing.T) {
	b := New()
	b.Set(Bid, 30, 5)
	b.Set(Bid, 32, 1)
	b.Set(Ask, 35, 2)
	b.Set(Ask, 34, 7)
	if px, _ := b.Best(Bid); px != 32 {
		t.Fatalf("best bid %d", px)
	}
	if px, _ := b.Best(Ask); px != 34 {
		t.Fatalf("best ask %d", px)
	}
	b.Set(Bid, 32, 0)
	if px, _ := b.Best(Bid); px != 30 {
		t.Fatalf("best bid after delete %d", px)
	}
	if got := b.Levels(Ask); !slices.Equal(got, []Level{{34, 7}, {35, 2}}) {
		t.Fatalf("asks %v", got)
	}
	if _, ok := New().Best(Ask); ok {
		t.Fatal("empty book has a best ask")
	}
}

func TestEqualAndDiff(t *testing.T) {
	a, b := New(), New()
	a.Set(Bid, 100_000_000, 5)
	b.Set(Bid, 100_000_000, 5)
	if !a.Equal(b) {
		t.Fatal("equal books differ")
	}
	b.Set(Ask, 200_000_000, 1)
	if a.Equal(b) {
		t.Fatal("different books equal")
	}
	if d := a.Diff(b, 5); len(d) != 1 || d[0] != "ask 2: 0 vs 0.00000001" {
		t.Fatalf("diff %v", d)
	}
}
