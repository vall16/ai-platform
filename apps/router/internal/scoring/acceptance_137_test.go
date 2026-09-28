package scoring

import (
	"context"
	"testing"

	"github.com/ai-platform/router/internal/provider"
)

// policyRegistry builds a registry with two LLM providers: a cheap one and an
// expensive one, with distinct latencies/reliabilities so the composite score
// is deterministic.
func policyRegistry() *provider.Registry {
	reg := provider.NewRegistry()
	reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID: "cheap", Name: "Cheap", Type: provider.TypeLLM,
		CostPerUnit: 20_000, LatencyMs: 500, SuccessRate: 0.97,
	}))
	reg.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID: "expensive", Name: "Expensive", Type: provider.TypeLLM,
		CostPerUnit: 200_000, LatencyMs: 200, SuccessRate: 0.995,
	}))
	return reg
}

// TestAcceptance137_CostAwareRouting is the Phase 6 acceptance test for
// cost-aware, plan-constrained routing: a plan policy can cap per-unit cost
// and/or restrict the provider allow-list, and the engine exposes a pre-flight
// session-cost estimate under the same policy.
func TestAcceptance137_CostAwareRouting(t *testing.T) {
	ctx := context.Background()

	t.Run("cost cap excludes over-budget providers", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		res, err := e.RouteWithPolicy(ctx, provider.TypeLLM, Policy{MaxCostPerUnitMicroUsd: 50_000})
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "cheap" {
			t.Fatalf("expected cheap under cost cap, got %s", res.SelectedProviderID)
		}
		// The expensive provider must be present but marked over_cost_cap.
		found := false
		for _, c := range res.Candidates {
			if c.ProviderID == "expensive" {
				found = true
				if c.Eligible || c.SkipReason != "over_cost_cap" {
					t.Fatalf("expensive: eligible=%v skip=%q, want ineligible over_cost_cap", c.Eligible, c.SkipReason)
				}
			}
		}
		if !found {
			t.Fatal("expensive provider missing from candidates")
		}
	})

	t.Run("allow-list restricts to named providers", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		res, err := e.RouteWithPolicy(ctx, provider.TypeLLM, Policy{AllowedProviderIDs: []string{"expensive"}})
		if err != nil {
			t.Fatal(err)
		}
		if res.SelectedProviderID != "expensive" {
			t.Fatalf("expected expensive under allow-list, got %s", res.SelectedProviderID)
		}
		for _, c := range res.Candidates {
			if c.ProviderID == "cheap" && (c.Eligible || c.SkipReason != "plan_not_allowed") {
				t.Fatalf("cheap: eligible=%v skip=%q, want ineligible plan_not_allowed", c.Eligible, c.SkipReason)
			}
		}
	})

	t.Run("no policy routes plan-agnostic (legacy behavior)", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		res, err := e.Route(ctx, provider.TypeLLM)
		if err != nil {
			t.Fatal(err)
		}
		// Cheap wins on the composite score (lower cost dominates).
		if res.SelectedProviderID != "cheap" {
			t.Fatalf("expected cheap with no policy, got %s", res.SelectedProviderID)
		}
	})

	t.Run("estimate picks cheapest eligible provider", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		est, err := e.EstimateSessionCost(provider.TypeLLM, 10, Policy{})
		if err != nil {
			t.Fatal(err)
		}
		if est.ProviderID != "cheap" || est.CostPerUnitMicroUsd != 20_000 {
			t.Fatalf("expected cheap @20000, got %s @%d", est.ProviderID, est.CostPerUnitMicroUsd)
		}
		if est.EstimatedTotalMicroUsd != 200_000 {
			t.Fatalf("expected total 200000, got %d", est.EstimatedTotalMicroUsd)
		}
	})

	t.Run("estimate honors cost cap", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		est, err := e.EstimateSessionCost(provider.TypeLLM, 5, Policy{MaxCostPerUnitMicroUsd: 50_000})
		if err != nil {
			t.Fatal(err)
		}
		if est.ProviderID != "cheap" || est.EstimatedTotalMicroUsd != 100_000 {
			t.Fatalf("expected cheap total 100000, got %s total %d", est.ProviderID, est.EstimatedTotalMicroUsd)
		}
	})

	t.Run("estimate honors allow-list", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		est, err := e.EstimateSessionCost(provider.TypeLLM, 2, Policy{AllowedProviderIDs: []string{"expensive"}})
		if err != nil {
			t.Fatal(err)
		}
		if est.ProviderID != "expensive" || est.EstimatedTotalMicroUsd != 400_000 {
			t.Fatalf("expected expensive total 400000, got %s total %d", est.ProviderID, est.EstimatedTotalMicroUsd)
		}
	})

	t.Run("estimate errors when no provider is eligible", func(t *testing.T) {
		e := NewEngine(policyRegistry(), nil, nil)
		if _, err := e.EstimateSessionCost(provider.TypeLLM, 5, Policy{MaxCostPerUnitMicroUsd: 10_000}); err == nil {
			t.Fatal("expected error when all providers exceed the cost cap")
		}
	})

	t.Run("plan policies resolve with fallback", func(t *testing.T) {
		pps := NewPlanPolicies(map[string]Policy{
			"starter": {MaxCostPerUnitMicroUsd: 50_000},
		}, Policy{MaxCostPerUnitMicroUsd: 100_000})
		if got := pps.For("starter").MaxCostPerUnitMicroUsd; got != 50_000 {
			t.Fatalf("starter: got %d, want 50000", got)
		}
		if got := pps.For("unknown").MaxCostPerUnitMicroUsd; got != 100_000 {
			t.Fatalf("unknown: got %d, want fallback 100000", got)
		}
		var nilPps *PlanPolicies
		if got := nilPps.For("anything"); got.MaxCostPerUnitMicroUsd != 0 {
			t.Fatalf("nil resolver: got %d, want 0", got.MaxCostPerUnitMicroUsd)
		}
	})
}
