package tap

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestKalshiSeqCheck(t *testing.T) {
	check := kalshiSeqCheck()
	for _, m := range []string{`{"type":"subscribed","sid":1}`, `{"sid":1,"seq":1}`, `{"sid":2,"seq":1}`, `{"sid":1,"seq":2}`} {
		if err := check([]byte(m)); err != nil {
			t.Fatalf("%s: %v", m, err)
		}
	}
	if check([]byte(`{"sid":1,"seq":4}`)) == nil {
		t.Fatal("seq gap not detected")
	}
}

func TestCheckSeriesRejectsDisallowedCategories(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cats := map[string]string{"/series/KXBTCD": "Crypto", "/series/KXNFLGAME": "Sports"}
		cat, ok := cats[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		fmt.Fprintf(w, `{"series":{"category":%q}}`, cat)
	}))
	defer srv.Close()
	old := kalshiAPI
	kalshiAPI = srv.URL
	defer func() { kalshiAPI = old }()

	ctx := context.Background()
	if err := CheckSeries(ctx, []string{"KXBTCD"}); err != nil {
		t.Fatalf("crypto series rejected: %v", err)
	}
	if err := CheckSeries(ctx, []string{"KXBTCD", "KXNFLGAME"}); err == nil || !strings.Contains(err.Error(), "Sports") {
		t.Fatalf("sports series accepted: %v", err)
	}
	if err := CheckSeries(ctx, []string{"KXNOPE"}); err == nil {
		t.Fatal("unknown series accepted")
	}
	if err := CheckSeries(ctx, nil); err == nil {
		t.Fatal("empty list accepted")
	}
}

func TestRotate(t *testing.T) {
	all := []string{"a", "b", "c", "d", "e"}
	got, next := rotate(all, 0, 2)
	if !slices.Equal(got, []string{"a", "b"}) || next != 2 {
		t.Fatalf("first: %v %d", got, next)
	}
	got, next = rotate(all, 4, 2) // wraps around
	if !slices.Equal(got, []string{"e", "a"}) || next != 1 {
		t.Fatalf("wrap: %v %d", got, next)
	}
	got, next = rotate(all, 9, 2) // the market list shrank since the last round
	if !slices.Equal(got, []string{"e", "a"}) || next != 1 {
		t.Fatalf("shrunk: %v %d", got, next)
	}
	if got, _ := rotate(all, 3, 10); len(got) != 5 {
		t.Fatalf("all: %v", got)
	}
}
