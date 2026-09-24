package scoring

import (
	"context"
	"testing"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/resilience"
)

// newBestEffortProvider returns a low-tier LLM provider intended to act as the
// graceful-degradation safety net (worse cost/latency/reliability than the
// primary providers in newFailoverRegistry).
func newBestEffortProvider() *provider.MockProvider {
	return provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-besteffort", Name: "BE", Type: provider.TypeLLM,
		CostPerUnit: 90_000, LatencyMs: 900, SuccessRate: 0.90,
	})
}

// TestAcceptance131_GracefulDegradation is the Phase 4 acceptance test for
// graceful degradation: the route result exposes the quality mode and the
// degradation level of the cascade, and when no primary provider is eligible
// the engine falls back to a designated best-effort provider instead of failing.
func TestAcceptance131_GracefulDegradation(t *testing.T) {
	ctx := context.Background()

	t.Run("full mode level 0 when top provider selected", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.Mode != ModeFull || res.DegradationLevel != 0 || res.Failover {
			t.Fatalf("expected full mode level 0, got mode=%s level=%d failover=%v", res.Mode, res.DegradationLevel, res.Failover)
		}
	})

	t.Run("degraded mode level 1 on single failover", func(t *testing.T) {
		reg, a, _, _ := newFailoverRegistry()
		a.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.Mode != ModeDegraded || res.DegradationLevel != 1 || !res.Failover {
			t.Fatalf("expected degraded mode level 1, got mode=%s level=%d failover=%v", res.Mode, res.DegradationLevel, res.Failover)
		}
	})

	t.Run("degradation level grows with cascade depth", func(t *testing.T) {
		reg, a, b, _ := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-c" || res.Mode != ModeDegraded || res.DegradationLevel != 2 {
			t.Fatalf("expected llm-c degraded level 2, got %s mode=%s level=%d", res.SelectedProviderID, res.Mode, res.DegradationLevel)
		}
	})

	t.Run("best-effort fallback when all primary down", func(t *testing.T) {
		reg, a, b, c := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		c.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		e.SetBestEffort(newBestEffortProvider())

		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-besteffort" || res.Mode != ModeBestEffort || !res.Failover {
			t.Fatalf("expected best-effort fallback, got %s mode=%s failover=%v", res.SelectedProviderID, res.Mode, res.Failover)
		}
	})

	t.Run("best-effort not used when a primary is available", func(t *testing.T) {
		reg, _, _, _ := newFailoverRegistry()
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		e.SetBestEffort(newBestEffortProvider())
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "llm-a" || res.Mode != ModeFull {
			t.Fatalf("expected primary llm-a full mode, got %s mode=%s", res.SelectedProviderID, res.Mode)
		}
	})

	t.Run("errors when all down and no best-effort", func(t *testing.T) {
		reg, a, b, c := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		c.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		if _, err := e.Route(ctx, provider.TypeLLM); err == nil {
			t.Fatal("expected error when no providers available and no best-effort")
		}
	})

	t.Run("errors when all down and best-effort also unhealthy", func(t *testing.T) {
		reg, a, b, c := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		c.SetHealthy(false)
		be := newBestEffortProvider()
		be.SetHealthy(false)
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
		e.SetBestEffort(be)
		if _, err := e.Route(ctx, provider.TypeLLM); err == nil {
			t.Fatal("expected error when best-effort is also unhealthy")
		}
	})

	t.Run("best-effort reserves quota", func(t *testing.T) {
		reg, a, b, c := newFailoverRegistry()
		a.SetHealthy(false)
		b.SetHealthy(false)
		c.SetHealthy(false)
		tracker := quota.NewTracker()
		e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), tracker)
		e.SetBestEffort(newBestEffortProvider())
		if _, err := e.Route(ctx, provider.TypeLLM); err != nil {
			t.Fatal(err)
		}
		if tracker.Active("llm-besteffort") != 1 {
			t.Fatalf("expected best-effort to hold 1 slot, got %d", tracker.Active("llm-besteffort"))
		}
	})
}
