package news

import (
	"os"
	"testing"
	"time"
)

// utc writes unix ms as an RFC 3339 UTC time, so expected values read as the feeds state them.
func utc(ms int64) string { return time.UnixMilli(ms).UTC().Format(time.RFC3339) }

func parse(t *testing.T, name string, f func([]byte) ([]Item, error)) []Item {
	t.Helper()
	body, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	items, err := f(body)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return items
}

func find(items []Item, id string) (Item, bool) {
	for _, it := range items {
		if it.ID == id {
			return it, true
		}
	}
	return Item{}, false
}

// Every sample saved from the live feeds on 2026-11-27; expected values read off the files.
func TestParsers(t *testing.T) {
	cases := []struct {
		file   string
		parse  func([]byte) ([]Item, error)
		n      int
		id     string
		title  string
		url    string
		stated string // UTC
	}{
		// "Wed, 25 Nov 2026 20:00:00 GMT", guid in CDATA, file starts with a byte-order mark.
		{"fed-press.xml", ParseRSS, 20,
			"https://www.federalreserve.gov/newsevents/pressreleases/bcreg20261125b.htm",
			"Agencies announce dollar thresholds for applicability of truth in lending and consumer leasing rules for consumer credit and lease transactions",
			"https://www.federalreserve.gov/newsevents/pressreleases/bcreg20261125b.htm",
			"2026-11-25T20:00:00Z"},
		{"fed-speech.xml", ParseRSS, 15, "", "", "", "2026-11-25T12:25:00Z"},
		// "Wed, 25 Nov 2026 08:30:00 EST": New York winter time, UTC−5. File declares us-ascii.
		{"bea.xml", ParseRSS, 50,
			"https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-3rd-quarter-2026",
			"GDP, (Second Estimate) and Corporate Profits, 3rd Quarter 2026",
			"https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-3rd-quarter-2026",
			"2026-11-25T13:30:00Z"},
		// "Wed, 25 Nov 26 12:00:00 +0000": two-digit year (and not the real release time, 13:30).
		{"dol.xml", ParseRSS, 10,
			"http://www.dol.gov/newsroom/releases/eta/eta20261125",
			"Unemployment Insurance Weekly Claims Report",
			"http://www.dol.gov/newsroom/releases/eta/eta20261125",
			"2026-11-25T12:00:00Z"},
		// "2026-11-10T07:55:47.272-05:00": staged ~34 min before the 8:30 ET release.
		{"bls-cpi.xml", ParseAtom, 12, "cpi-2026_11_10__07_55_47",
			"CPI for all items increases 0.4% in October; shelter rises",
			"https://www.bls.gov/news.release/archives/cpi_11102026.htm",
			"2026-11-10T12:55:47Z"},
		{"bls-payrolls.xml", ParseAtom, 12, "empsit-2026_11_06__07_50_31",
			"Payroll employment rises by 165,000 in October; unemployment rate changes little at 4.1%",
			"https://www.bls.gov/news.release/archives/empsit_11062026.htm",
			"2026-11-06T12:50:31Z"},
		// <time datetime=2026-11-23T18:00:00Z> then the link; ’ kept as written.
		{"treasury-press.html", ParseTreasuryPress, 10, "/news/press-releases/sb0699/",
			"Operation Economic Outcast Disrupts Iran’s Global Shadow Banking Networks",
			"https://home.treasury.gov/news/press-releases/sb0699/",
			"2026-11-23T18:00:00Z"},
		// 7-year note: closed 2026-11-25 11:30 AM New York = 16:30 UTC; high yield 4.708, 2.43.
		{"treasury-auction.json", ParseAuctions, 11, "91282CSA0-2026-11-25",
			"7-Year Note auction: high yield 4.708%, bid-to-cover 2.43",
			"https://www.treasurydirect.gov/auctions/announcements-data-results/",
			"2026-11-25T16:30:00Z"},
	}
	for _, c := range cases {
		items := parse(t, c.file, c.parse)
		if len(items) != c.n {
			t.Errorf("%s: %d items, want %d", c.file, len(items), c.n)
		}
		got := items[0]
		if c.id != "" {
			var ok bool
			if got, ok = find(items, c.id); !ok {
				t.Errorf("%s: no item %q", c.file, c.id)
				continue
			}
		}
		if c.title != "" && (got.Title != c.title || got.URL != c.url) {
			t.Errorf("%s: got %q %q, want %q %q", c.file, got.Title, got.URL, c.title, c.url)
		}
		if utc(got.StatedMs) != c.stated {
			t.Errorf("%s: stated %s, want %s", c.file, utc(got.StatedMs), c.stated)
		}
		// DOL's feed lists one release twice; the collector keeps the first. A repeat must be the
		// same item, or the first one seen would decide arbitrarily.
		seen := map[string]Item{}
		for _, it := range items {
			if it.ID == "" || it.Title == "" || it.StatedMs == 0 {
				t.Errorf("%s: empty field in %+v", c.file, it)
			}
			if prev, ok := seen[it.ID]; ok && prev != it {
				t.Errorf("%s: %q repeated with different contents", c.file, it.ID)
			}
			seen[it.ID] = it
		}
	}
}

// "Thu, 29 Oct 2026 08:30:00 EDT" is New York summer time, UTC−4: 12:30 UTC. Go alone would give
// an unknown abbreviation a zero offset (08:30 UTC).
func TestSummerTime(t *testing.T) {
	got, err := parseRSSDate("Thu, 29 Oct 2026 08:30:00 EDT")
	if err != nil || got.UTC().Format(time.RFC3339) != "2026-10-29T12:30:00Z" {
		t.Fatalf("got %v %v", got.UTC(), err)
	}
}

// A bill's result is its high rate; a floating-rate note's its high discount margin.
func TestAuctionResults(t *testing.T) {
	items := parse(t, "treasury-auction.json", ParseAuctions)
	if it, _ := find(items, "912797WH6-2026-11-25"); it.Title != "4-Week Bill auction: high rate 4.115%, bid-to-cover 2.64" ||
		utc(it.StatedMs) != "2026-11-25T15:00:00Z" { // 10:00 AM New York
		t.Errorf("4-week bill: %q %s", it.Title, utc(it.StatedMs))
	}
	body := []byte(`[{"cusip":"X","securityDescription":"2-Year FRN","competitiveAuctionCloseDate":"2026-11-24T00:00:00",
		"competitiveAuctionCloseTime":"11:30 AM","highDiscountMargin":"0.205","bidToCoverRatio":"3.01"},
		{"cusip":"Y","securityDescription":"5-Year Note","competitiveAuctionCloseDate":"2026-11-27T00:00:00",
		"competitiveAuctionCloseTime":"01:00 PM"}]`)
	got, err := ParseAuctions(body)
	if err != nil || len(got) != 1 || got[0].Title != "2-Year FRN auction: high discount margin 0.205%, bid-to-cover 3.01" {
		t.Fatalf("got %+v %v (the 5-year note has no result yet and is skipped)", got, err)
	}
}

func TestTreasuryLayoutChange(t *testing.T) {
	if _, err := ParseTreasuryPress([]byte("<html>maintenance</html>")); err == nil {
		t.Fatal("a page with no releases must be an error")
	}
}

func TestInterval(t *testing.T) {
	ny := newYork
	at := func(d, h, m int) time.Time { return time.Date(2026, 11, d, h, m, 0, 0, ny) } // Nov 27 is a Friday
	fed, bls := Sources[0], Sources[6]
	cases := []struct {
		src   Source
		now   time.Time
		fails int
		want  time.Duration
	}{
		{fed, at(27, 3, 0), 0, 15 * time.Second},
		{fed, at(27, 3, 0), 1, 30 * time.Second},
		{fed, at(27, 3, 0), 4, 4 * time.Minute}, // 15 s × 16
		{fed, at(27, 3, 0), 5, 5 * time.Minute}, // 8 min, capped
		{fed, at(27, 3, 0), 60, 5 * time.Minute},
		{bls, at(27, 8, 30), 0, 15 * time.Second}, // in the window
		{bls, at(27, 8, 30), 2, time.Minute},      // backing off inside it too
		{bls, at(27, 8, 27), 0, 2 * time.Minute},  // wakes at 8:29, not 8:32
		{bls, at(27, 7, 0), 0, 5 * time.Minute},   // long before
		{bls, at(27, 8, 45), 0, 5 * time.Minute},  // window over
		{bls, at(30, 8, 26), 0, 3 * time.Minute},  // Monday
		{bls, at(28, 8, 30), 0, 5 * time.Minute},  // Saturday: no window
		{bls, at(29, 23, 58), 0, 5 * time.Minute}, // Sunday night
		{bls, at(30, 8, 28), 0, time.Minute},      // Monday, a minute to go
		{bls, at(27, 8, 44), 0, 15 * time.Second}, // last minute of the window
		{bls, at(27, 8, 44), 10, 5 * time.Minute}, // errors still cap at 5 min
	}
	for _, c := range cases {
		if got := Interval(c.src, c.now, c.fails); got != c.want {
			t.Errorf("%s at %s, %d fails: %s, want %s", c.src.Name, c.now.Format("Mon 15:04"), c.fails, got, c.want)
		}
	}
}
