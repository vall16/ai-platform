package obs

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestLogEmitsStructuredJSON(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "router")
	l.Info("route", "provider", "llm", "resource_type", "llm")

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("not valid JSON: %v (%q)", err, buf.String())
	}
	if rec["level"] != "info" || rec["service"] != "router" || rec["msg"] != "route" {
		t.Errorf("unexpected record: %v", rec)
	}
	if rec["provider"] != "llm" || rec["resource_type"] != "llm" {
		t.Errorf("fields missing: %v", rec)
	}
	if _, ok := rec["ts"]; !ok {
		t.Error("missing ts")
	}
	if _, ok := rec["trace_id"]; ok {
		t.Error("trace_id should be absent when unbound")
	}
}

func TestWithTraceBindsTraceID(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "router")
	child := l.WithTrace("4bf92f3577b34da6a3ce929d0e0e4736")
	child.Warn("circuit_open", "provider", "llm-a")

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if rec["trace_id"] != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("trace_id = %v", rec["trace_id"])
	}
	if rec["level"] != "warn" {
		t.Errorf("level = %v", rec["level"])
	}
}

func TestParentUnaffectedByChild(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "router")
	_ = l.WithTrace("abc")
	l.Info("no trace here")

	line := buf.String()
	if strings.Contains(line, "trace_id") {
		t.Errorf("parent line should not carry trace_id: %s", line)
	}
}

func TestDanglingKeyBecomesNull(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf, "router")
	l.Error("boom", "orphan")

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if v, ok := rec["orphan"]; !ok || v != nil {
		t.Errorf("orphan = %v (ok=%v), want null", v, ok)
	}
}
