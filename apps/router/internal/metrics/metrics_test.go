package metrics

import (
	"strings"
	"testing"
)

func TestRenderCounterGaugeHistogram(t *testing.T) {
	r := New()
	c := r.Counter("router_route_requests_total", "Total route decisions made")
	g := r.Gauge("router_active_sessions", "Active sessions")
	h := r.Histogram("router_route_duration_seconds", "Route decision duration in seconds", []float64{0.01, 0.05, 1})

	c.Inc(Labels{"resource_type": "llm", "status": "200"})
	c.Inc(Labels{"resource_type": "llm", "status": "200"})
	c.Add(Labels{"resource_type": "stt", "status": "503"}, 3)
	g.Set(Labels{}, 7)
	h.Observe(Labels{"resource_type": "llm"}, 0.005)
	h.Observe(Labels{"resource_type": "llm"}, 0.02)
	h.Observe(Labels{"resource_type": "llm"}, 2.0)

	out := r.Render()

	want := []string{
		"# TYPE router_route_requests_total counter",
		`router_route_requests_total{resource_type="llm",status="200"} 2`,
		`router_route_requests_total{resource_type="stt",status="503"} 3`,
		"# TYPE router_active_sessions gauge",
		"router_active_sessions 7",
		"# TYPE router_route_duration_seconds histogram",
		`router_route_duration_seconds_bucket{le="0.01",resource_type="llm"} 1`,
		`router_route_duration_seconds_bucket{le="0.05",resource_type="llm"} 2`,
		`router_route_duration_seconds_bucket{le="1",resource_type="llm"} 2`,
		`router_route_duration_seconds_bucket{le="+Inf",resource_type="llm"} 3`,
		`router_route_duration_seconds_count{resource_type="llm"} 3`,
	}
	for _, line := range want {
		if !strings.Contains(out, line) {
			t.Errorf("rendered output missing %q\n---\n%s", line, out)
		}
	}

	// The histogram sum must equal 0.005 + 0.02 + 2.0.
	if !strings.Contains(out, "router_route_duration_seconds_sum{resource_type=\"llm\"} 2.025") {
		t.Errorf("unexpected histogram sum in output:\n%s", out)
	}
}

func TestLabelEscaping(t *testing.T) {
	if got := escapeLabelValue(`a"b\c`); got != `a\"b\\c` {
		t.Errorf("escapeLabelValue = %q", got)
	}
	if got := labelKey(Labels{"b": "2", "a": "1"}); got != `{a="1",b="2"}` {
		t.Errorf("labelKey = %q", got)
	}
	if got := labelKey(Labels{}); got != "" {
		t.Errorf("labelKey(empty) = %q", got)
	}
}
