package rawlog

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Files lists every raw log file under dir in time order: by date, then by when the file was
// opened, then by venue. Names are <HH>-<MMSS>.jsonl.gz; the older <HH>.jsonl.gz sorts as
// <HH>-0000, so archives from before 2026-11-12 read in order too.
func Files(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*", "*", "*.jsonl.gz"))
	if err != nil {
		return nil, err
	}
	slices.SortFunc(files, func(a, b string) int { return strings.Compare(OrderKey(a), OrderKey(b)) })
	return files, nil
}

// OrderKey sorts raw log paths in time order (see Files).
func OrderKey(path string) string {
	name := strings.TrimSuffix(filepath.Base(path), ".jsonl.gz")
	if !strings.Contains(name, "-") {
		name += "-0000"
	}
	return filepath.Base(filepath.Dir(path)) + "/" + name + "/" + path
}

// Info describes what reading a file found besides its records.
type Info struct {
	// Truncated: the file ends mid-record, as a file still being written (or cut by a crash)
	// does. The partial last record is dropped.
	Truncated bool
	// Corrupt: stretches of damaged gzip data that were skipped. Reading resumes at the next
	// gzip member, so a crash in the middle of a file loses only the damaged part.
	Corrupt int
}

var gzipMagic = []byte{0x1f, 0x8b, 0x08}

// ReadFile calls fn for every record in a file, one gzip member at a time.
func ReadFile(path string, fn func(Record) error) (Info, error) {
	var info Info
	data, err := os.ReadFile(path)
	if err != nil {
		return info, err
	}
	// After a damaged member, reading resumes at the next gzip header. The header's bytes can
	// also occur by chance inside compressed data, so a skip counts as recovered corruption only
	// if real records follow it; otherwise the file just ends early (a file still being written).
	pos, pending := 0, false
	for pos < len(data) {
		used, clean, n, err := readMember(data[pos:], fn)
		if err != nil {
			return info, err
		}
		if pending && (clean || n > 0) {
			info.Corrupt++
			pending = false
		}
		if clean {
			pos += used
			continue
		}
		next := bytes.Index(data[pos+1:], gzipMagic)
		if next < 0 {
			info.Truncated = true
			return info, nil
		}
		pending = true
		pos += 1 + next
	}
	return info, nil
}

// readMember decodes the gzip member at the start of data, calling fn for each complete line.
// clean reports whether it ended with a valid trailer, used how many bytes it took, and n how
// many records it yielded.
func readMember(data []byte, fn func(Record) error) (used int, clean bool, n int, err error) {
	r := bytes.NewReader(data) // a ByteReader, so gzip reads exactly one member and no further
	gz, err := gzip.NewReader(r)
	if err != nil {
		return 0, false, 0, nil
	}
	gz.Multistream(false)
	br := bufio.NewReaderSize(gz, 1<<20)
	for {
		line, rerr := br.ReadBytes('\n')
		if len(line) > 0 && line[len(line)-1] == '\n' {
			var rec Record
			if jerr := json.Unmarshal(line, &rec); jerr == nil {
				n++
				if ferr := fn(rec); ferr != nil {
					return 0, false, n, ferr
				}
			}
		}
		switch {
		case rerr == nil:
			continue
		case errors.Is(rerr, io.EOF):
			return len(data) - r.Len(), true, n, nil
		default: // unexpected EOF or a corrupt block
			return 0, false, n, nil
		}
	}
}
