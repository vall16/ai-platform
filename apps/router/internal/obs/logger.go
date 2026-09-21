// Package obs provides a minimal structured (JSON) logger using only the
// standard library. Every line is a single JSON object with a timestamp, level,
// service name, message and optional fields; a trace id can be bound to a child
// logger so all lines for one request carry the same trace_id.
package obs

import (
	"encoding/json"
	"io"
	"sync"
	"time"
)

// Logger writes structured JSON log lines to a writer. It is safe for
// concurrent use.
type Logger struct {
	mu    sync.Mutex
	w     io.Writer
	svc   string
	trace string // bound trace id, empty when unbound
}

// New returns a Logger writing to w, tagging every line with the service name.
func New(w io.Writer, service string) *Logger {
	return &Logger{w: w, svc: service}
}

// WithTrace returns a child logger that includes trace_id in every line it
// writes. The parent is unaffected.
func (l *Logger) WithTrace(traceID string) *Logger {
	return &Logger{w: l.w, svc: l.svc, trace: traceID}
}

// Info logs a message at level "info" with optional key/value fields.
func (l *Logger) Info(msg string, kv ...any) { l.log("info", msg, kv...) }

// Warn logs a message at level "warn" with optional key/value fields.
func (l *Logger) Warn(msg string, kv ...any) { l.log("warn", msg, kv...) }

// Error logs a message at level "error" with optional key/value fields.
func (l *Logger) Error(msg string, kv ...any) { l.log("error", msg, kv...) }

func (l *Logger) log(level, msg string, kv ...any) {
	rec := map[string]any{
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"level":   level,
		"service": l.svc,
		"msg":     msg,
	}
	if l.trace != "" {
		rec["trace_id"] = l.trace
	}
	// Pair up key/value args; a dangling key is recorded as null.
	for i := 0; i < len(kv); i += 2 {
		key, ok := kv[i].(string)
		if !ok {
			key = "field"
		}
		if i+1 < len(kv) {
			rec[key] = kv[i+1]
		} else {
			rec[key] = nil
		}
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	line = append(line, '\n')
	_, _ = l.w.Write(line)
}
