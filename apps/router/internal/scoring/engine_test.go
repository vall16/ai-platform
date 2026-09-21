package scoring

import (
	"context"
	"testing"
	"time"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/resilience"
)

// newTestRegistry registers two LLM providers where "llm-a" always scores
// higher than "llm-b", so any selection of "llm-b" implies a failover.
func newTestRegistry() (*provider.Registry, *provider.MockProvider, *provider.MockProvider) {
	reg := provider.NewRegistry()
	a := provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-a", Name: "A", Type: provider.TypeLLM,
		CostPerUnit: 10_000, LatencyMs: 100, SuccessRate: 0.99,
	})
	b := provider.NewMockProvider(provider.MockProviderConfig{
		ID: "llm-b", Name: "B", Type: provider.TypeLLM,
		CostPerUnit: 50_000, LatencyMs: 500, SuccessRate: 0.97,
	})
	reg.Register(a)
	reg.Register(b)
	return reg, a, b
}

func TestRouteSelectsBest(t *testing.T) {
	reg, _, _ := newTestRegistry()
	e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
	res, err := e.Route(context.Background(), provider.TypeLLM)
	if err != nil {
		t.Fatal(err)
	}
	if res.SelectedProviderID != "llm-a" {
		t.Fatalf("expected llm-a, got %s", res.SelectedProviderID)
	}
	if res.Failover {
		t.Fatal("expected no failover")
	}
}

func TestRouteFailoverOnUnhealthy(t *testing.T) {
	reg, a, _ := newTestRegistry()
	a.SetHealthy(false)
	e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
	res, err := e.Route(context.Background(), provider.TypeLLM)
	if err != nil {
		t.Fatal(err)
	}
	if res.SelectedProviderID != "llm-b" {
		t.Fatalf("expected failover to llm-b, got %s", res.SelectedProviderID)
	}
	if !res.Failover {
		t.Fatal("expected failover=true")
	}
}

func TestRouteFailoverOnCircuitOpen(t *testing.T) {
	reg, _, _ := newTestRegistry()
	breakers := resilience.NewManager(resilience.Config{
		FailureThreshold: 2, Window: time.Minute, OpenDuration: time.Hour,
	})
	e := NewEngine(reg, breakers, quota.NewTracker())
	e.RecordOutcome("llm-a", false)
	e.RecordOutcome("llm-a", false)

	res, err := e.Route(context.Background(), provider.TypeLLM)
	if err != nil {
		t.Fatal(err)
	}
	if res.SelectedProviderID != "llm-b" {
		t.Fatalf("expected failover to llm-b, got %s", res.SelectedProviderID)
	}
	if !res.Failover {
		t.Fatal("expected failover=true")
	}
	for _, c := range res.Candidates {
		if c.ProviderID == "llm-a" && c.SkipReason != "circuit_open" {
			t.Fatalf("expected llm-a skip_reason=circuit_open, got %q", c.SkipReason)
		}
	}
}

func TestRouteFailoverOnQuota(t *testing.T) {
	reg, _, _ := newTestRegistry()
	tracker := quota.NewTracker()
	tracker.SetLoad("llm-a", 100) // mock MaxConcurrentSessions is 100
	e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), tracker)

	res, err := e.Route(context.Background(), provider.TypeLLM)
	if err != nil {
		t.Fatal(err)
	}
	if res.SelectedProviderID != "llm-b" {
		t.Fatalf("expected failover to llm-b, got %s", res.SelectedProviderID)
	}
	if !res.Failover {
		t.Fatal("expected failover=true")
	}
	for _, c := range res.Candidates {
		if c.ProviderID == "llm-a" && c.SkipReason != "over_quota" {
			t.Fatalf("expected llm-a skip_reason=over_quota, got %q", c.SkipReason)
		}
	}
}

func TestRouteReservesQuotaForSelected(t *testing.T) {
	reg, _, _ := newTestRegistry()
	tracker := quota.NewTracker()
	e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), tracker)
	if _, err := e.Route(context.Background(), provider.TypeLLM); err != nil {
		t.Fatal(err)
	}
	if tracker.Active("llm-a") != 1 {
		t.Fatalf("expected llm-a to hold 1 slot, got %d", tracker.Active("llm-a"))
	}
}

func TestRouteNoAvailableProviders(t *testing.T) {
	reg, a, b := newTestRegistry()
	a.SetHealthy(false)
	b.SetHealthy(false)
	e := NewEngine(reg, resilience.NewManager(resilience.DefaultConfig()), quota.NewTracker())
	if _, err := e.Route(context.Background(), provider.TypeLLM); err == nil {
		t.Fatal("expected error when no providers available")
	}
}
