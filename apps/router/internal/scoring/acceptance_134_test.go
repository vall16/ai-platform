package scoring

import (
	"context"
	"testing"
	"time"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/redis"
	"github.com/ai-platform/router/internal/resilience"
)

// newHAInstance builds one router "instance": an engine with its own registry
// (a single provider of the given capacity) but sharing the supplied quota and
// breaker stores. This mirrors a horizontally-scaled deployment where every
// replica keeps its own provider view but coordinates state through a shared
// store.
func newHAInstance(reg *provider.Registry, breakers resilience.Store, tracker quota.Store) *Engine {
	return NewEngine(reg, breakers, tracker)
}

// singleProviderRegistry returns a registry with one LLM provider of the given
// concurrent-session capacity.
func singleProviderRegistry(id string, limit int) *provider.Registry {
	reg := provider.NewRegistry()
	reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID: id, Name: id, Type: provider.TypeLLM,
		CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
		MaxConcurrentSessions: limit,
	}))
	return reg
}

// TestAcceptance134_RouterHA is the Phase 4 acceptance test for horizontal
// scaling: with the quota and circuit-breaker state externalized to a shared
// store, N router instances coordinate so that (a) a provider's
// MaxConcurrentSessions is enforced fleet-wide (never over-allocated) and (b)
// a breaker that trips on one instance is honored by every other instance.
func TestAcceptance134_RouterHA(t *testing.T) {
	ctx := context.Background()
	const limit = 5
	const instances = 3

	t.Run("quota is enforced fleet-wide via shared store", func(t *testing.T) {
		tracker := quota.NewTracker()
		engines := make([]*Engine, instances)
		for i := range engines {
			engines[i] = newHAInstance(singleProviderRegistry("p", limit), nil, tracker)
		}
		// Each instance keeps routing until the shared capacity is exhausted.
		total := 0
		for i := range engines {
			for {
				if _, err := engines[i].Route(ctx, provider.TypeLLM); err != nil {
					break
				}
				total++
				if total > instances*limit+1 {
					t.Fatalf("runaway routing: %d", total)
				}
			}
		}
		if total != limit {
			t.Fatalf("expected total routes capped at %d (shared), got %d", limit, total)
		}
		if tracker.Active("p") != limit {
			t.Fatalf("expected active=%d, got %d", limit, tracker.Active("p"))
		}
	})

	t.Run("without a shared store each instance over-allocates", func(t *testing.T) {
		// Contrast: per-instance trackers let every replica fill its own quota,
		// so the fleet serves instances*limit sessions — the bug HA fixes.
		total := 0
		for i := 0; i < instances; i++ {
			tracker := quota.NewTracker()
			e := newHAInstance(singleProviderRegistry("p", limit), nil, tracker)
			for {
				if _, err := e.Route(ctx, provider.TypeLLM); err != nil {
					break
				}
				total++
			}
		}
		if total != instances*limit {
			t.Fatalf("expected %d (per-instance over-allocation), got %d", instances*limit, total)
		}
	})

	t.Run("quota is enforced fleet-wide via redis store", func(t *testing.T) {
		fake := redis.NewFake()
		tracker := quota.NewRedisStore(fake, "", 0)
		engines := make([]*Engine, instances)
		for i := range engines {
			engines[i] = newHAInstance(singleProviderRegistry("p", limit), nil, tracker)
		}
		total := 0
		for i := range engines {
			for {
				if _, err := engines[i].Route(ctx, provider.TypeLLM); err != nil {
					break
				}
				total++
				if total > instances*limit+1 {
					t.Fatalf("runaway routing: %d", total)
				}
			}
		}
		if total != limit {
			t.Fatalf("expected total routes capped at %d (shared redis), got %d", limit, total)
		}
		if tracker.Active("p") != limit {
			t.Fatalf("expected active=%d, got %d", limit, tracker.Active("p"))
		}
	})

	t.Run("breaker trip propagates to every instance", func(t *testing.T) {
		breakers := resilience.NewManager(resilience.Config{
			FailureThreshold: 2, Window: time.Minute, OpenDuration: time.Hour,
		})
		// Two providers: p (best) and q (fallback). A trip on p must push every
		// instance to fail over to q.
		reg := provider.NewRegistry()
		reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
			ID: "p", Name: "P", Type: provider.TypeLLM,
			CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
		}))
		reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
			ID: "q", Name: "Q", Type: provider.TypeLLM,
			CostPerUnit: 50_000, LatencyMs: 500, SuccessRate: 0.97,
		}))
		engines := make([]*Engine, instances)
		for i := range engines {
			engines[i] = newHAInstance(reg, breakers, nil)
		}

		// Before the trip, every instance picks the best provider p.
		for i, e := range engines {
			res, err := e.Route(ctx, provider.TypeLLM)
			if err != nil {
				t.Fatal(err)
			}
			if res.SelectedProviderID != "p" {
				t.Fatalf("instance %d: expected p before trip, got %s", i, res.SelectedProviderID)
			}
		}

		// Trip the breaker via instance 0 only.
		engines[0].RecordOutcome("p", false)
		engines[0].RecordOutcome("p", false)

		// Now EVERY instance must fail over to q (they all see p as circuit-open).
		for i, e := range engines {
			res, err := e.Route(ctx, provider.TypeLLM)
			if err != nil {
				t.Fatal(err)
			}
			if res.SelectedProviderID != "q" || !res.Failover {
				t.Fatalf("instance %d: expected failover to q after trip, got %s failover=%v", i, res.SelectedProviderID, res.Failover)
			}
		}
	})

	t.Run("breaker trip propagates via redis store", func(t *testing.T) {
		fake := redis.NewFake()
		breakers := resilience.NewRedisStore(fake, resilience.Config{
			FailureThreshold: 2, Window: time.Minute, OpenDuration: time.Hour,
		}, "", 0)
		reg := provider.NewRegistry()
		reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
			ID: "p", Name: "P", Type: provider.TypeLLM,
			CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
		}))
		reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
			ID: "q", Name: "Q", Type: provider.TypeLLM,
			CostPerUnit: 50_000, LatencyMs: 500, SuccessRate: 0.97,
		}))
		engines := make([]*Engine, instances)
		for i := range engines {
			engines[i] = newHAInstance(reg, breakers, nil)
		}

		engines[0].RecordOutcome("p", false)
		engines[0].RecordOutcome("p", false)

		for i, e := range engines {
			res, err := e.Route(ctx, provider.TypeLLM)
			if err != nil {
				t.Fatal(err)
			}
			if res.SelectedProviderID != "q" || !res.Failover {
				t.Fatalf("instance %d: expected failover to q after trip, got %s failover=%v", i, res.SelectedProviderID, res.Failover)
			}
		}
	})
}
