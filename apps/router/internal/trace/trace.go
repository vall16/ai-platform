// Package trace implements W3C Trace Context propagation (the `traceparent`
// header) plus X-Trace-Id fallback, using only the standard library. It lets
// the router continue an inbound trace (so a request that spans backend ->
// router -> provider shares one trace id) or start a new one, and echo the
// context back on the response.
package trace

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
)

// Context is a W3C trace context: a 32-hex trace id, a 16-hex span id and the
// sampled flag.
type Context struct {
	TraceID string
	SpanID  string
	Sampled bool
}

// New returns a fresh context with a random trace id and span id, sampled.
func New() Context {
	return Context{TraceID: randomHex(16), SpanID: randomHex(8), Sampled: true}
}

// ParseTraceparent parses a W3C `traceparent` header of the form
// "00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>". It returns the
// context and whether the header was valid.
func ParseTraceparent(h string) (Context, bool) {
	parts := strings.Split(h, "-")
	if len(parts) != 4 {
		return Context{}, false
	}
	version, traceID, parentID, flags := parts[0], parts[1], parts[2], parts[3]
	if len(version) != 2 || !isHex(version) {
		return Context{}, false
	}
	if version == "ff" { // reserved: undefined version
		return Context{}, false
	}
	if len(traceID) != 32 || !isHex(traceID) || isAllZero(traceID) {
		return Context{}, false
	}
	if len(parentID) != 16 || !isHex(parentID) || isAllZero(parentID) {
		return Context{}, false
	}
	if len(flags) != 2 || !isHex(flags) {
		return Context{}, false
	}
	return Context{
		TraceID: strings.ToLower(traceID),
		SpanID:  strings.ToLower(parentID),
		Sampled: flags[0] == '1' || flags[1] == '1',
	}, true
}

// BuildTraceparent renders the context as a W3C `traceparent` header.
func BuildTraceparent(c Context) string {
	flags := "00"
	if c.Sampled {
		flags = "01"
	}
	return "00-" + c.TraceID + "-" + c.SpanID + "-" + flags
}

// FromHeaders extracts a context from inbound headers, continuing an existing
// trace when possible and always minting a fresh span id for this hop.
// Precedence: valid `traceparent` > `X-Trace-Id` > new trace.
func FromHeaders(get func(string) string) Context {
	if h := get("traceparent"); h != "" {
		if c, ok := ParseTraceparent(h); ok {
			// Continue the trace, start a new span for this service.
			return Context{TraceID: c.TraceID, SpanID: randomHex(8), Sampled: c.Sampled}
		}
	}
	if id := get("X-Trace-Id"); id != "" {
		return Context{TraceID: NormalizeTraceID(id), SpanID: randomHex(8), Sampled: true}
	}
	return New()
}

// NormalizeTraceID turns an arbitrary correlation id (e.g. a UUID) into a
// valid 32-hex W3C trace id: it keeps the hex characters, truncates to 32 and
// left-pads with zeros. A UUID with its dashes stripped is already 32 hex.
// If no hex characters remain it returns a random trace id.
func NormalizeTraceID(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			b.WriteRune(r)
		}
	}
	hexChars := b.String()
	if len(hexChars) == 0 {
		return randomHex(16)
	}
	if len(hexChars) > 32 {
		hexChars = hexChars[:32]
	}
	for len(hexChars) < 32 {
		hexChars = "0" + hexChars
	}
	return hexChars
}

func randomHex(nBytes int) string {
	buf := make([]byte, nBytes)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failing is effectively impossible; fall back to zeros
		// rather than panic in a request path.
		return strings.Repeat("0", nBytes*2)
	}
	return hex.EncodeToString(buf)
}

func isHex(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func isAllZero(s string) bool {
	for _, r := range s {
		if r != '0' {
			return false
		}
	}
	return true
}
