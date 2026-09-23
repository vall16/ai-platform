package scoring

import (
	"context"
	"testing"
	"time"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/resilience"
)

// newFailoverRegistry registers three LLM providers ordered by score:
// llm-a (best) > llm-b > llm-c (worst). Any selection below llm-a implies a
// failover, and a selection of llm-c implies a cascading (multi-step) failover.
func newFailoverRegistry() (*provider.Registry, *provider.MockProvider, *provider.MockProvider, *provider.MockProvider) {
	reg := provider.NewRegistry()
	a := provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-a", Name: "A", Type: provider.TypeLLM,
		CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
	})
	b := provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-b", Name: "B", Type: provider.TypeLLM,
		CostPerUnit: 30_000, LatencyMs: 300, SuccessRate: 0.98,
	})
	c := provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-c", Name: "C", Type: provider.TypeLLM,
		CostPerUnit: 50_000, LatencyMs: 500, SuccessRate: 0.97,
	})
	reg.Register(a)
	reg.Register(b)
	reg.Register(c)
	return reg, a, b, c
}

// TestAcceptance127_RouterFailover is the Phase 3 acceptance test for the
// router: it verifies that the scoring engine fails over correctly across the
// three resilience gates (health, circuit breaker, quota) and that cascading
// failover reaches the next-best eligible provider.
func TestAcceptance127_RouterFailover(t *testing.T) {
	ctx := context.Background()

	t.Run("selects best when all healthy", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-a" || res.Failover {
			t.Fatalf("expected llm-a with no failover, got %s failover=%v", res.SelectedProviderID, res.Failover)
		}
	})

	t.Run("fails over on unhealthy", func(t *testing.T) {
		reg, a, _, _ := newFailoverRegistry()
		a.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-b" || !res.Failover {
			t.Fatalf("expected failover to llm-b, got %s failover=%v", res.SelectedProviderID, res.Failover)
		}
	})

	t.Run("fails over on circuit open", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		breakers := resilience.NewManager(resilience.Config{
			FailureThreshold: 2, Window: time.Minute, OpenDuration: time.Hour,
		})
		e := NewEngine(reg, breakers, quota.NewTracker())
		e.RecordOutcome("llm-a", false)
		e.RecordOutcome("llm-a", false)

		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-b" || !res.Failover {
			t.Fatalf("expected failover to llm-b, got %s failover=%v", res.SelectedProviderID, res.Failover)
		}
		for _, c := range res.Candidates {
			if c.ProviderID == "llm-a" && c.SkipReason != "circuit_open" {
				t.Fatalf("expected llm-a skip_reason=circuit_open, got %q", c.SkipReason)
			}
		}
	})

	t.Run("fails over on quota", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		tracker := quota.NewTracker()
		tracker.SetLoad("llm-a", 100) // mock MaxConcurrentSessions is 100
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), tracker)

		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-b" || !res.Failover {
			t.Fatalf("expected failover to llm-b, got %s failover=%v", res.SelectedProviderID, res.Failover)
		}
		for _, c := range res.Candidates {
			if c.ProviderID == "llm-a" && c.SkipReason != "over_quota" {
				t.Fatalf("expected llm-a skip_reason=over_quota, got %q", c.SkipReason)
			}
		}
	})

	t.Run("cascades across two gates to llm-c", func(t *testing.T) {
		reg, a, _, _ := newFailoverRegistry()
		a.SetHealthy(false) // gate 1: health
		breakers := resilience.NewManager(resilience.Config{
			FailureThreshold: 1, Window: time.Minute, OpenDuration: time.Hour,
		})
		e := NewEngine(reg, breakers, quota.NewTracker())
		e.RecordOutcome("llm-b", false) // gate 2: circuit on llm-b

		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-c" || !res.Failover {
			t.Fatalf("expected cascading failover to llm-c, got %s failover=%v", res.SelectedProviderID, res.Failover)
		}
	})

	t.Run("reserves quota for selected provider", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		tracker := quota.NewTracker()
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), tracker)
		if _, err := e.Route(ctx, provider.TypeLLM); err != nil {
			t.Fatal(err)
		}
		if tracker.Active("llm-a") != 1 {
			t.Fatalf("expected llm-a to hold 1 slot, got %d", tracker.Active("llm-a"))
		}
	})

	t.Run("errors when no provider available", func(t *testing.T) {
		reg, a, b, c := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		c.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		if _, err := e.Route(ctx, provider.TypeLLM); err == nil {
			t.Fatal("expected error when no providers available")
		}
	})
}
