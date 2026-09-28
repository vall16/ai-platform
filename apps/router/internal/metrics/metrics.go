// Package metrics provides a minimal, self-contained Prometheus metrics
// registry. It has no external dependencies so the router can expose /metrics
// without adding a client library. It renders the standard Prometheus text
// exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/).
package metrics

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// Labels is a set of label key/value pairs attached to a metric sample.
type Labels map[string]string

// escapeLabelValue escapes a label value per the Prometheus exposition format.
func escapeLabelValue(v string) string {
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, `"`, `\"`)
	v = strings.ReplaceAll(v, "\n", `\n`)
	return v
}

// labelKey renders a label set as `{k="v",...}` with keys sorted for stable output.
func labelKey(labels Labels) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteByte('"')
		b.WriteString(escapeLabelValue(labels[k]))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String()
}

type metric interface {
	render() string
}

// Counter is a monotonically increasing metric.
type Counter struct {
	name   string
	help   string
	mu     sync.Mutex
	values map[string]float64
}

// Inc increases the counter by 1 for the given label set.
func (c *Counter) Inc(labels Labels) { c.Add(labels, 1) }

// Add increases the counter by amount for the given label set.
func (c *Counter) Add(labels Labels, amount float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.values == nil {
		c.values = make(map[string]float64)
	}
	c.values[labelKey(labels)] += amount
}

func (c *Counter) render() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s counter\n", c.name, c.help, c.name)
	keys := make([]string, 0, len(c.values))
	for k := range c.values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, "%s%s %g\n", c.name, k, c.values[k])
	}
	return b.String()
}

// Gauge is a metric that can go up and down.
type Gauge struct {
	name   string
	help   string
	mu     sync.Mutex
	values map[string]float64
}

// Set sets the gauge to value for the given label set.
func (g *Gauge) Set(labels Labels, value float64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.values == nil {
		g.values = make(map[string]float64)
	}
	g.values[labelKey(labels)] = value
}

func (g *Gauge) render() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s gauge\n", g.name, g.help, g.name)
	keys := make([]string, 0, len(g.values))
	for k := range g.values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, "%s%s %g\n", g.name, k, g.values[k])
	}
	return b.String()
}

type histogramEntry struct {
	labels Labels
	counts []int64
	sum    float64
	total  int64
}

// Histogram is a metric that aggregates observations into buckets.
type Histogram struct {
	name    string
	help    string
	buckets []float64
	mu      sync.Mutex
	entries map[string]*histogramEntry
}

// Observe records a single observation for the given label set.
func (h *Histogram) Observe(labels Labels, value float64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.entries == nil {
		h.entries = make(map[string]*histogramEntry)
	}
	key := labelKey(labels)
	e := h.entries[key]
	if e == nil {
		e = &histogramEntry{labels: labels, counts: make([]int64, len(h.buckets))}
		h.entries[key] = e
	}
	// Increment only the first bucket the value falls into; render() applies
	// the cumulative sum, so incrementing every matching bucket would double-count.
	for i, b := range h.buckets {
		if value <= b {
			e.counts[i]++
			break
		}
	}
	e.sum += value
	e.total++
}

func (h *Histogram) render() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP %s %s\n# TYPE %s histogram\n", h.name, h.help, h.name)
	keys := make([]string, 0, len(h.entries))
	for k := range h.entries {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		e := h.entries[k]
		var cumulative int64
		for i, bucket := range h.buckets {
			cumulative += e.counts[i]
			merged := make(Labels, len(e.labels)+1)
			for lk, lv := range e.labels {
				merged[lk] = lv
			}
			merged["le"] = fmt.Sprintf("%g", bucket)
			fmt.Fprintf(&b, "%s_bucket%s %d\n", h.name, labelKey(merged), cumulative)
		}
		inf := make(Labels, len(e.labels)+1)
		for lk, lv := range e.labels {
			inf[lk] = lv
		}
		inf["le"] = "+Inf"
		fmt.Fprintf(&b, "%s_bucket%s %d\n", h.name, labelKey(inf), e.total)
		fmt.Fprintf(&b, "%s_sum%s %g\n", h.name, labelKey(e.labels), e.sum)
		fmt.Fprintf(&b, "%s_count%s %d\n", h.name, labelKey(e.labels), e.total)
	}
	return b.String()
}

// Registry holds a set of metrics and renders them together.
type Registry struct {
	mu      sync.Mutex
	metrics []metric
}

// New creates an empty registry.
func New() *Registry { return &Registry{} }

// Counter registers and returns a new counter.
func (r *Registry) Counter(name, help string) *Counter {
	c := &Counter{name: name, help: help}
	r.mu.Lock()
	r.metrics = append(r.metrics, c)
	r.mu.Unlock()
	return c
}

// Gauge registers and returns a new gauge.
func (r *Registry) Gauge(name, help string) *Gauge {
	g := &Gauge{name: name, help: help}
	r.mu.Lock()
	r.metrics = append(r.metrics, g)
	r.mu.Unlock()
	return g
}

// Histogram registers and returns a new histogram with the given bucket boundaries.
func (r *Registry) Histogram(name, help string, buckets []float64) *Histogram {
	sorted := make([]float64, len(buckets))
	copy(sorted, buckets)
	sort.Float64s(sorted)
	h := &Histogram{name: name, help: help, buckets: sorted}
	r.mu.Lock()
	r.metrics = append(r.metrics, h)
	r.mu.Unlock()
	return h
}

// Render renders all metrics in Prometheus text exposition format.
func (r *Registry) Render() string {
	r.mu.Lock()
	metrics := make([]metric, len(r.metrics))
	copy(metrics, r.metrics)
	r.mu.Unlock()
	var b strings.Builder
	for _, m := range metrics {
		b.WriteString(m.render())
		b.WriteByte('\n')
	}
	return b.String()
}
