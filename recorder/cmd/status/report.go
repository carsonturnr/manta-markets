package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The JSON report (-json) that infra/deploy/manta-quality.service stores for the site's
// data-quality page. Times are UTC.
type report struct {
	Generated  time.Time    `json:"generated"`   // when the files were listed (the run takes a minute or two)
	GapSeconds float64      `json:"gap_seconds"` // the -gap threshold
	Venues     []venueJSON  `json:"venues"`
	Families   []familyJSON `json:"families"`
}

type venueJSON struct {
	Venue    string           `json:"venue"`
	First    time.Time        `json:"first"`
	Last     time.Time        `json:"last"` // last data record (files are flushed about once a second)
	Records  int64            `json:"records"`
	Coverage float64          `json:"coverage"` // share of [first, last] not in a gap, 0–1
	Gaps     []gapJSON        `json:"gaps"`     // every gap, oldest first
	Hours    map[string]int64 `json:"hours"`    // records per hour over the last 7 days, "2026-11-16T14"
}

type gapJSON struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

type familyJSON struct {
	Venue      string `json:"venue"`
	Family     string `json:"family"`
	Records24h int64  `json:"records_24h"`
	Contracts  int    `json:"contracts"` // distinct contracts with data in the last 2 hours (max per file)
}

// hourOf parses the hour from a file path: <venue>/<date>/<HH>[-NNNN].jsonl.gz.
func hourOf(rel string) time.Time {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) < 3 || len(parts[2]) < 2 {
		return time.Time{}
	}
	t, _ := time.Parse("2006-01-02/15", parts[1]+"/"+parts[2][:2])
	return t
}

// coverage is the share of a venue's recorded span not lost to gaps.
func coverage(r *venueReport) float64 {
	span := r.last - r.first
	if span <= 0 {
		return 1
	}
	var lost int64
	for _, g := range r.gaps {
		lost += g[1] - g[0]
	}
	return float64(span-lost) / float64(span)
}

func utcNs(ns int64) time.Time { return time.Unix(0, ns).UTC() }

func writeReport(path string, now time.Time, gap time.Duration, venues []string, reports map[string]*venueReport,
	paths []string, indexed map[string]fileSummary) error {
	rep := report{Generated: now, GapSeconds: gap.Seconds(), Venues: []venueJSON{}, Families: []familyJSON{}}
	byVenue := map[string]*venueJSON{}
	for _, v := range venues {
		r := reports[v]
		if r.first == 0 {
			continue
		}
		vj := venueJSON{Venue: v, First: utcNs(r.first), Last: utcNs(r.last), Records: r.records,
			Coverage: coverage(r), Gaps: []gapJSON{}, Hours: map[string]int64{}}
		gaps := append([][2]int64(nil), r.gaps...)
		sort.Slice(gaps, func(i, j int) bool { return gaps[i][0] < gaps[j][0] })
		for _, g := range gaps {
			vj.Gaps = append(vj.Gaps, gapJSON{utcNs(g[0]), utcNs(g[1])})
		}
		rep.Venues = append(rep.Venues, vj)
	}
	for i := range rep.Venues {
		byVenue[rep.Venues[i].Venue] = &rep.Venues[i]
	}

	type key struct{ venue, family string }
	fams := map[key]*familyJSON{}
	for _, p := range paths {
		s, h := indexed[p], hourOf(p)
		age := now.Sub(h)
		if vj := byVenue[s.Venue]; vj != nil && age < 7*24*time.Hour {
			vj.Hours[h.Format("2006-01-02T15")] += s.Records
		}
		if age >= 24*time.Hour {
			continue
		}
		for name, st := range s.Families {
			k := key{s.Venue, name}
			f := fams[k]
			if f == nil {
				f = &familyJSON{Venue: s.Venue, Family: name}
				fams[k] = f
			}
			f.Records24h += st.Records
			// The current hour and the one before it: an hour is about 1 hour old once it ends.
			if age < 2*time.Hour {
				f.Contracts = max(f.Contracts, st.Contracts)
			}
		}
	}
	for _, f := range fams {
		rep.Families = append(rep.Families, *f)
	}
	sort.Slice(rep.Families, func(i, j int) bool {
		a, b := rep.Families[i], rep.Families[j]
		return a.Venue < b.Venue || a.Venue == b.Venue && a.Family < b.Family
	})

	b, err := json.Marshal(rep)
	if err != nil {
		return err
	}
	// Write then rename, so a reader never sees half a file.
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
