package rawlog

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
)

// Files lists every raw log file under dir in time order (per venue, then merged by name:
// <venue>/<YYYY-MM-DD>/<HH>.jsonl.gz sorts chronologically within a venue).
func Files(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*", "*", "*.jsonl.gz"))
	if err != nil {
		return nil, err
	}
	slices.SortFunc(files, func(a, b string) int {
		// date/hour first so venues interleave by hour
		ka := filepath.Base(filepath.Dir(a)) + filepath.Base(a) + a
		kb := filepath.Base(filepath.Dir(b)) + filepath.Base(b) + b
		switch {
		case ka < kb:
			return -1
		case ka > kb:
			return 1
		}
		return 0
	})
	return files, nil
}

// ReadFile calls fn for every record in a file. A file still being written ends without a
// gzip trailer; reading stops cleanly at the last complete line and Truncated reports it.
func ReadFile(path string, fn func(Record) error) (truncated bool, err error) {
	fh, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer fh.Close()
	gz, err := gzip.NewReader(fh)
	if err != nil {
		return false, err
	}
	br := bufio.NewReaderSize(gz, 1<<20)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 && line[len(line)-1] == '\n' {
			var r Record
			if jerr := json.Unmarshal(line, &r); jerr != nil {
				return false, jerr
			}
			if ferr := fn(r); ferr != nil {
				return false, ferr
			}
		}
		switch {
		case err == nil:
			continue
		case errors.Is(err, io.EOF):
			// A partial last line (no '\n') is an unflushed tail; drop it.
			return len(line) > 0, nil
		case errors.Is(err, io.ErrUnexpectedEOF):
			return true, nil
		default:
			return false, err
		}
	}
}
