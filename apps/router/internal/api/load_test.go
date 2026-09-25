package api

import (
	"context"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/resilience"
	"github.com/ai-platform/router/internal/scoring"
)

// loadEngine builds the stateless, horizontally-scaled routing engine: two LLM
// providers of the given per-provider capacity sharing one in-memory quota
// tracker and breaker manager. This is the configuration a fleet of router
// replicas would run with — every replica keeps its own provider view but
// coordinates quota and breaker state through the shared store.
func loadEngine(perProviderCapacity int) (*scoring.Engine, *quota.Tracker) {
	reg := provider.NewRegistry()
	reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-a", Name: "A", Type: provider.TypeLLM,
		CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
		MaxConcurrentSessions: perProviderCapacity,
	}))
	reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-b", Name: "B", Type: provider.TypeLLM,
		CostPerUnit: 30_000, LatencyMs: 300, SuccessRate: 0.98,
		MaxConcurrentSessions: perProviderCapacity,
	}))
	tracker := quota.NewTracker()
	breakers := resilience.NewManager(resilience.DefaultConfig())
	return scoring.NewEngine(reg, breakers, tracker), tracker
}

// runLoad fires n concurrent routing decisions through a bounded worker pool
// and returns the count of successful routes, the count of rejections, the
// per-decision latencies, and the total wall-clock duration. No release is
// issued, so every successful route holds its slot for the duration of the
// test — simulating n concurrent live sessions against a fixed fleet capacity.
func runLoad(engine *scoring.Engine, n, workers int) (ok, rejected int, latencies []time.Duration, elapsed time.Duration) {
	ctx := context.Background()
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, workers)
	start := time.Now()

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			s := time.Now()
			if _, err := engine.Route(ctx, provider.TypeLLM); err != nil {
				mu.Lock()
				rejected++
				mu.Unlock()
				return
			}
			lat := time.Since(s)
			mu.Lock()
			ok++
			latencies = append(latencies, lat)
			mu.Unlock()
		}()
	}
	wg.Wait()
	return ok, rejected, latencies, time.Since(start)
}

// percentile returns the p-th percentile (0-100) of the given durations.
func percentile(d []time.Duration, p int) time.Duration {
	if len(d) == 0 {
		return 0
	}
	s := make([]time.Duration, len(d))
	copy(s, d)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	idx := (p*len(s) + 99) / 100 // ceiling index
	if idx >= len(s) {
		idx = len(s) - 1
	}
	return s[idx]
}

// TestLoad_1k10k is the Phase 4 load test: it drives the stateless routing
// engine with 1k and 10k concurrent session-routing decisions against a fleet
// of fixed total capacity and asserts the horizontal-scaling invariant — the
// shared quota store never lets the fleet exceed the providers' combined
// MaxConcurrentSessions (no over-allocation) — while reporting latency
// percentiles and throughput.
func TestLoad_1k10k(t *testing.T) {
	const perProvider = 500 // two providers -> 1000 total capacity
	const totalCapacity = 2 * perProvider

	t.Run("1k sessions fit within capacity", func(t *testing.T) {
		engine, tracker := loadEngine(perProvider)
		ok, rejected, lat, elapsed := runLoad(engine, 1000, 256)
		if ok != 1000 || rejected != 0 {
			t.Fatalf("expected 1000 ok / 0 rejected, got ok=%d rejected=%d", ok, rejected)
		}
		for _, id := range []string{"llm-a", "llm-b"} {
			if p := tracker.Peak(id); p > perProvider {
				t.Fatalf("provider %s peak %d exceeds capacity %d", id, p, perProvider)
			}
		}
		t.Logf("1k: ok=%d rejected=%d p50=%s p99=%s throughput=%.0f req/s",
			ok, rejected, percentile(lat, 50), percentile(lat, 99), float64(len(lat))/elapsed.Seconds())
	})

	t.Run("10k sessions never over-allocate", func(t *testing.T) {
		engine, tracker := loadEngine(perProvider)
		ok, rejected, lat, elapsed := runLoad(engine, 10000, 256)
		if ok != totalCapacity {
			t.Fatalf("expected exactly %d ok (capacity), got %d", totalCapacity, ok)
		}
		if rejected != 10000-totalCapacity {
			t.Fatalf("expected %d rejected, got %d", 10000-totalCapacity, rejected)
		}
		for _, id := range []string{"llm-a", "llm-b"} {
			if p := tracker.Peak(id); p > perProvider {
				t.Fatalf("provider %s peak %d exceeds capacity %d (over-allocation)", id, p, perProvider)
			}
		}
		if p99 := percentile(lat, 99); p99 > 30*time.Second {
			t.Fatalf("p99 latency %s indicates a hang", p99)
		}
		if elapsed > 60*time.Second {
			t.Fatalf("load run took %s (hang)", elapsed)
		}
		t.Logf("10k: ok=%d rejected=%d p50=%s p99=%s throughput=%.0f req/s",
			ok, rejected, percentile(lat, 50), percentile(lat, 99), float64(len(lat))/elapsed.Seconds())
	})
}
