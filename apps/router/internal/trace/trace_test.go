package trace

import (
	"strings"
	"testing"
)

func TestParseTraceparentValid(t *testing.T) {
	h := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	c, ok := ParseTraceparent(h)
	if !ok {
		t.Fatal("expected valid traceparent")
	}
	if c.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("traceID = %q", c.TraceID)
	}
	if c.SpanID != "00f067aa0ba902b7" {
		t.Errorf("spanID = %q", c.SpanID)
	}
	if !c.Sampled {
		t.Error("expected sampled")
	}
}

func TestParseTraceparentInvalid(t *testing.T) {
	cases := []string{
		"",
		"garbage",
		"00-abc-00f067aa0ba902b7-01",            // short trace id
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7", // missing flags
		"ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", // reserved version
		"00-00000000000000000000000000000000-00f067aa0ba902b7-01", // all-zero trace id
		"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01", // all-zero parent id
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0g", // bad flags
	}
	for _, h := range cases {
		if _, ok := ParseTraceparent(h); ok {
			t.Errorf("ParseTraceparent(%q) = ok, want invalid", h)
		}
	}
}

func TestBuildTraceparentRoundTrip(t *testing.T) {
	c := Context{TraceID: "4bf92f3577b34da6a3ce929d0e0e4736", SpanID: "00f067aa0ba902b7", Sampled: true}
	h := BuildTraceparent(c)
	if h != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Errorf("BuildTraceparent = %q", h)
	}
	back, ok := ParseTraceparent(h)
	if !ok {
		t.Fatal("round-trip parse failed")
	}
	if back.TraceID != c.TraceID || back.SpanID != c.SpanID || back.Sampled != c.Sampled {
		t.Errorf("round-trip mismatch: %+v", back)
	}
}

func TestFromHeadersContinuesTraceparent(t *testing.T) {
	in := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	get := func(k string) string {
		if strings.EqualFold(k, "traceparent") {
			return in
		}
		return ""
	}
	c := FromHeaders(get)
	if c.TraceID != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("traceID not continued: %q", c.TraceID)
	}
	if c.SpanID == "00f067aa0ba902b7" {
		t.Error("expected a fresh span id for this hop")
	}
	if len(c.SpanID) != 16 {
		t.Errorf("spanID length = %d, want 16", len(c.SpanID))
	}
}

func TestFromHeadersFallsBackToXTraceId(t *testing.T) {
	// A UUID with dashes stripped is a valid 32-hex trace id.
	uuid := "123e4567-e89b-12d3-a456-426614174000"
	get := func(k string) string {
		if strings.EqualFold(k, "X-Trace-Id") {
			return uuid
		}
		return ""
	}
	c := FromHeaders(get)
	want := "123e4567e89b12d3a456426614174000"
	if c.TraceID != want {
		t.Errorf("traceID = %q, want %q", c.TraceID, want)
	}
}

func TestFromHeadersStartsNewWhenAbsent(t *testing.T) {
	c := FromHeaders(func(string) string { return "" })
	if len(c.TraceID) != 32 || len(c.SpanID) != 16 {
		t.Errorf("unexpected lengths: trace=%d span=%d", len(c.TraceID), len(c.SpanID))
	}
	if !c.Sampled {
		t.Error("expected sampled by default")
	}
}

func TestNormalizeTraceID(t *testing.T) {
	if got := NormalizeTraceID("123e4567-e89b-12d3-a456-426614174000"); got != "123e4567e89b12d3a456426614174000" {
		t.Errorf("uuid -> %q", got)
	}
	// Short input is left-padded with zeros.
	if got := NormalizeTraceID("abc"); got != "00000000000000000000000000000abc" {
		t.Errorf("short -> %q", got)
	}
	// Non-hex-only input yields a random 32-hex id.
	if got := NormalizeTraceID("!!!"); len(got) != 32 {
		t.Errorf("non-hex -> %q (len %d)", got, len(got))
	}
}
