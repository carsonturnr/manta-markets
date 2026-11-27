// Package news reads official news feeds (docs/plan-news-events.md): the Fed's press-release and
// speech RSS, Treasury's press page and auction results, BEA's RSS, DOL's releases RSS and BLS's
// CPI and payrolls Atom feeds. Each parser turns one response body into items; cmd/news polls the
// feeds and stamps each new item with the moment we first received it.
package news

import (
	"bytes"
	"cmp"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // New York time must parse even on a machine without a zone database
)

// Item is one piece of news, one JSON line in the collector's daily file.
type Item struct {
	Source string `json:"source"` // a Source's Name
	ID     string `json:"id"`     // unique within its source (the feed's guid or link)
	Title  string `json:"title"`
	URL    string `json:"url"`
	// StatedMs is when the source says it published, unix ms; StatedReal is false when that time
	// is known not to be a real publication time (see Source.StatedReal).
	StatedMs   int64 `json:"stated_ms"`
	StatedReal bool  `json:"stated_real"`
	// ReceivedMs is when our poller first got it. Backfill marks items already in a feed when the
	// collector (re)started: their receipt time is not a real one and never enters delay figures.
	ReceivedMs int64 `json:"received_ms"`
	Backfill   bool  `json:"backfill,omitempty"`
}

// Source is one feed and how to read it.
type Source struct {
	Name  string
	URL   string
	Parse func(body []byte) ([]Item, error)
	// ReleaseOnly feeds are polled fast only around the 8:30 ET release minute (BLS, DOL): their
	// news comes at scheduled times, and they block robots that poll too eagerly.
	ReleaseOnly bool
	// StatedReal is false where the feed's time is measured not to be the publication time
	// (2026-11-27): DOL stamps 12:00 UTC for a 13:30 UTC release, BLS's `published` is ~40 min
	// before the 8:30 release (staged), Treasury press times can sit 10 min before posting.
	StatedReal bool
}

// Sources is every feed collected, in the plan's order.
var Sources = []Source{
	{Name: "fed-press", URL: "https://www.federalreserve.gov/feeds/press_all.xml", Parse: ParseRSS, StatedReal: true},
	{Name: "fed-speech", URL: "https://www.federalreserve.gov/feeds/speeches.xml", Parse: ParseRSS, StatedReal: true},
	{Name: "treasury-press", URL: "https://home.treasury.gov/news/press-releases", Parse: ParseTreasuryPress},
	{Name: "treasury-auction", URL: "https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&days=7", Parse: ParseAuctions, StatedReal: true},
	{Name: "bea", URL: "https://apps.bea.gov/rss/rss.xml", Parse: ParseRSS, StatedReal: true},
	{Name: "dol", URL: "https://www.dol.gov/rss/releases.xml", Parse: ParseRSS, ReleaseOnly: true},
	{Name: "bls-cpi", URL: "https://www.bls.gov/feed/cpi.rss", Parse: ParseAtom, ReleaseOnly: true},
	{Name: "bls-payrolls", URL: "https://www.bls.gov/feed/empsit.rss", Parse: ParseAtom, ReleaseOnly: true},
}

var newYork = mustZone("America/New_York")

func mustZone(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

// decoder reads XML that may start with a byte-order mark (the Fed's feeds) or declare us-ascii
// (BEA's), a subset of UTF-8 that encoding/xml otherwise refuses.
func decoder(body []byte) *xml.Decoder {
	d := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(body, []byte("\xef\xbb\xbf"))))
	d.CharsetReader = func(charset string, r io.Reader) (io.Reader, error) {
		if strings.EqualFold(charset, "us-ascii") {
			return r, nil
		}
		return nil, fmt.Errorf("unsupported charset %q", charset)
	}
	return d
}

// RSS dates come as "Wed, 25 Nov 2026 20:00:00 GMT" (Fed), "… 08:30:00 EST" (BEA) and
// "Wed, 25 Nov 26 12:00:00 +0000" (DOL, two-digit year), and "Mon, 9 Nov …" (Fed, one-digit day:
// layout "2" takes one or two digits). EST and EDT are read as New York time: Go gives an unknown
// abbreviation a zero offset, which would be 5 hours off.
var rssLayouts = []string{"Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST", "Mon, 2 Jan 06 15:04:05 -0700"}

func parseRSSDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range rssLayouts {
		if t, err := time.ParseInLocation(layout, s, newYork); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unreadable date %q", s)
}

// ParseRSS reads an RSS 2.0 feed. An item's id is its guid, or its link where it has none.
func ParseRSS(body []byte) ([]Item, error) {
	var feed struct {
		Items []struct {
			Title   string `xml:"title"`
			Link    string `xml:"link"`
			GUID    string `xml:"guid"`
			PubDate string `xml:"pubDate"`
		} `xml:"channel>item"`
	}
	if err := decoder(body).Decode(&feed); err != nil {
		return nil, err
	}
	var out []Item
	for _, it := range feed.Items {
		t, err := parseRSSDate(it.PubDate)
		if err != nil {
			return nil, err
		}
		link := strings.TrimSpace(it.Link)
		id := cmp.Or(strings.TrimSpace(it.GUID), link)
		if id == "" {
			return nil, fmt.Errorf("item %q has neither guid nor link", it.Title)
		}
		out = append(out, Item{ID: id, Title: clean(it.Title), URL: link, StatedMs: t.UnixMilli()})
	}
	return out, nil
}

// ParseAtom reads an Atom feed (BLS's per-release feeds).
func ParseAtom(body []byte) ([]Item, error) {
	var feed struct {
		Entries []struct {
			Title string `xml:"title"`
			Link  struct {
				Href string `xml:"href,attr"`
			} `xml:"link"`
			ID        string `xml:"id"`
			Published string `xml:"published"`
		} `xml:"entry"`
	}
	if err := decoder(body).Decode(&feed); err != nil {
		return nil, err
	}
	var out []Item
	for _, e := range feed.Entries {
		t, err := time.Parse(time.RFC3339, strings.TrimSpace(e.Published))
		if err != nil {
			return nil, err
		}
		if e.ID == "" {
			return nil, fmt.Errorf("entry %q has no id", e.Title)
		}
		out = append(out, Item{ID: e.ID, Title: clean(e.Title), URL: e.Link.Href, StatedMs: t.UnixMilli()})
	}
	return out, nil
}

// Treasury's press page has no feed; its server-rendered list holds the 10 newest releases as
// <time datetime=…> followed by <h3 …><a href=/news/press-releases/sb0699/ …>Title</a>.
var treasuryItem = regexp.MustCompile(`<time datetime="?([0-9TZ:-]+)"?[^>]*>[\s\S]*?<h3[^>]*>\s*<a href="?(/news/press-releases/[a-z0-9-]+/?)"?[^>]*>([^<]+)</a>`)

// ParseTreasuryPress reads home.treasury.gov/news/press-releases. An empty list is an error: it
// means the page's layout changed, which must show in the logs, not as a quiet feed.
func ParseTreasuryPress(body []byte) ([]Item, error) {
	var out []Item
	for _, m := range treasuryItem.FindAllSubmatch(body, -1) {
		t, err := time.Parse(time.RFC3339, string(m[1]))
		if err != nil {
			return nil, err
		}
		path := string(m[2])
		out = append(out, Item{ID: path, Title: clean(string(m[3])),
			URL: "https://home.treasury.gov" + path, StatedMs: t.UnixMilli()})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no press releases found: has the page's layout changed?")
	}
	return out, nil
}

// ParseAuctions reads TreasuryDirect's list of auctions with results. The stated time is the
// close of competitive bidding (New York time); the title gives the result: high yield (notes,
// bonds), high rate (bills) or high discount margin (floating-rate notes), and bid-to-cover.
func ParseAuctions(body []byte) ([]Item, error) {
	var rows []struct {
		Cusip       string `json:"cusip"`
		Description string `json:"securityDescription"`
		Term        string `json:"securityTerm"`
		Type        string `json:"securityType"`
		CloseDate   string `json:"competitiveAuctionCloseDate"`
		CloseTime   string `json:"competitiveAuctionCloseTime"`
		HighYield   string `json:"highYield"`
		HighRate    string `json:"highRate"`
		HighMargin  string `json:"highDiscountMargin"`
		BidToCover  string `json:"bidToCoverRatio"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, err
	}
	var out []Item
	for _, r := range rows {
		day, _, _ := strings.Cut(r.CloseDate, "T")
		t, err := time.ParseInLocation("2006-01-02 03:04 PM", day+" "+r.CloseTime, newYork)
		if err != nil {
			return nil, fmt.Errorf("auction %s: close time: %w", r.Cusip, err)
		}
		var result string
		switch {
		case r.HighYield != "":
			result = "high yield " + r.HighYield + "%"
		case r.HighRate != "":
			result = "high rate " + r.HighRate + "%"
		case r.HighMargin != "":
			result = "high discount margin " + r.HighMargin + "%"
		default:
			continue // no result yet: it is listed again once it has one
		}
		if r.BidToCover != "" {
			result += ", bid-to-cover " + r.BidToCover
		}
		name := cmp.Or(r.Description, r.Term+" "+r.Type)
		out = append(out, Item{ID: r.Cusip + "-" + day, Title: name + " auction: " + result,
			URL: "https://www.treasurydirect.gov/auctions/announcements-data-results/", StatedMs: t.UnixMilli()})
	}
	return out, nil
}

// clean unescapes HTML entities left in titles and folds runs of white space.
func clean(s string) string {
	return strings.Join(strings.Fields(html.UnescapeString(s)), " ")
}

// Fast is the polling interval when news may be due; Slow the interval for a release-only feed
// outside its window, and the ceiling of the back-off after errors.
const (
	Fast = 15 * time.Second
	Slow = 5 * time.Minute
)

// Interval is how long to wait before polling src again, after fails failed polls in a row.
// Errors (including 403 and 429) double the wait, up to Slow, so a site that blocks robots is
// never hammered. A release-only feed is polled every Fast from 8:29 to 8:45 New York time on
// weekdays and every Slow otherwise, but never sleeps past its window's start.
func Interval(src Source, now time.Time, fails int) time.Duration {
	base := Fast
	if src.ReleaseOnly {
		start, end := releaseWindow(now)
		switch {
		case now.Before(start):
			base = min(Slow, start.Sub(now))
		case !now.Before(end):
			base = min(Slow, nextWindowStart(now).Sub(now))
		}
	}
	for range fails {
		base *= 2
		if base >= Slow {
			return Slow
		}
	}
	return base
}

// releaseWindow is today's 8:29–8:45 New York time; on a weekend it is empty (start = end).
func releaseWindow(now time.Time) (start, end time.Time) {
	ny := now.In(newYork)
	start = time.Date(ny.Year(), ny.Month(), ny.Day(), 8, 29, 0, 0, newYork)
	if wd := ny.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return start, start
	}
	return start, start.Add(16 * time.Minute)
}

// nextWindowStart is the start of the next weekday's window after now.
func nextWindowStart(now time.Time) time.Time {
	ny := now.In(newYork)
	for d := 1; ; d++ {
		day := time.Date(ny.Year(), ny.Month(), ny.Day()+d, 8, 29, 0, 0, newYork)
		if wd := day.Weekday(); wd != time.Saturday && wd != time.Sunday {
			return day
		}
	}
}
