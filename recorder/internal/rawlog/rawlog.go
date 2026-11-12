// Package rawlog appends raw venue messages to hourly gzip JSONL files:
//
//	<dir>/<venue>/<YYYY-MM-DD>/<HH>.jsonl.gz
//
// One record per line: {"recv_ns":…,"venue":…,"stream":…,"msg":<raw venue JSON>}.
// Files are flushed every second; a restart appends a new gzip member to the same hour,
// which gzip readers concatenate. Write errors are returned, never swallowed.
package rawlog

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Record is one line of a raw log file.
type Record struct {
	RecvNs int64           `json:"recv_ns"`
	Venue  string          `json:"venue"`
	Stream string          `json:"stream"`
	Msg    json.RawMessage `json:"msg"`
}

type file struct {
	hour time.Time
	f    *os.File
	gz   *gzip.Writer
	buf  *bufio.Writer
}

// Writer is safe for concurrent use.
type Writer struct {
	dir   string
	now   func() time.Time
	mu    sync.Mutex
	files map[string]*file // by venue
	// OnWrite, if set, is called with each record after it is written, in write order, while
	// the writer's lock is held. It must not block or call back into the Writer.
	OnWrite func(Record)
}

// New creates a Writer rooted at dir. now is injectable for tests (nil = time.Now).
func New(dir string, now func() time.Time) *Writer {
	if now == nil {
		now = time.Now
	}
	return &Writer{dir: dir, now: now, files: map[string]*file{}}
}

// Write appends one record. msg must be valid JSON; non-JSON payloads are stored as a JSON string.
func (w *Writer) Write(venue, stream string, msg []byte) error {
	t := w.now().UTC()
	if !json.Valid(msg) {
		quoted, _ := json.Marshal(string(msg))
		msg = quoted
	}
	rec := Record{RecvNs: t.UnixNano(), Venue: venue, Stream: stream, Msg: msg}
	line, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	f, err := w.fileFor(venue, t)
	if err != nil {
		return err
	}
	if _, err := f.buf.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("rawlog %s: %w", venue, err)
	}
	if w.OnWrite != nil {
		w.OnWrite(rec)
	}
	return nil
}

// Status writes a recorder status record (stream "status").
func (w *Writer) Status(venue, state, detail string) error {
	msg, _ := json.Marshal(map[string]string{"state": state, "detail": detail})
	return w.Write(venue, "status", msg)
}

func (w *Writer) fileFor(venue string, t time.Time) (*file, error) {
	hour := t.Truncate(time.Hour)
	if f := w.files[venue]; f != nil {
		if f.hour.Equal(hour) {
			return f, nil
		}
		if err := f.close(); err != nil {
			return nil, err
		}
		delete(w.files, venue)
	}
	path := filepath.Join(w.dir, venue, hour.Format("2006-01-02"), hour.Format("15")+".jsonl.gz")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	fh, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return nil, err
	}
	gz := gzip.NewWriter(fh)
	f := &file{hour: hour, f: fh, gz: gz, buf: bufio.NewWriterSize(gz, 1<<16)}
	w.files[venue] = f
	return f, nil
}

func (f *file) flush() error {
	if err := f.buf.Flush(); err != nil {
		return err
	}
	return f.gz.Flush()
}

func (f *file) close() error {
	if err := f.flush(); err != nil {
		return err
	}
	if err := f.gz.Close(); err != nil {
		return err
	}
	return f.f.Close()
}

// Flush pushes buffered records to disk (gzip sync flush) and fsyncs.
func (w *Writer) Flush() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	for venue, f := range w.files {
		if err := f.flush(); err != nil {
			return fmt.Errorf("rawlog %s: %w", venue, err)
		}
		if err := f.f.Sync(); err != nil {
			return fmt.Errorf("rawlog %s: %w", venue, err)
		}
	}
	return nil
}

// Close flushes and closes every open file.
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	var first error
	for venue, f := range w.files {
		if err := f.close(); err != nil && first == nil {
			first = fmt.Errorf("rawlog %s: %w", venue, err)
		}
		delete(w.files, venue)
	}
	return first
}
