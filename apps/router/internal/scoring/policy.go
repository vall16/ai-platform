package scoring

// Policy constrains routing for a plan. Zero values mean "no constraint", so
// the zero Policy routes exactly like the legacy, plan-agnostic Route.
type Policy struct {
	// MaxCostPerUnitMicroUsd caps the per-unit cost of eligible providers.
	// A provider whose CostPerUnit exceeds this is skipped. 0 = no cap.
	MaxCostPerUnitMicroUsd int64
	// AllowedProviderIDs restricts routing to these provider IDs. Empty = all.
	AllowedProviderIDs []string
}

// PlanPolicies resolves a plan name (the opaque subscription.plan string) to
// its routing policy. Unknown plans fall back to a default policy.
type PlanPolicies struct {
	byPlan   map[string]Policy
	fallback Policy
}

// NewPlanPolicies builds a resolver from a plan->policy map and a fallback
// policy used for plans that are not in the map.
func NewPlanPolicies(byPlan map[string]Policy, fallback Policy) *PlanPolicies {
	m := make(map[string]Policy, len(byPlan))
	for k, v := range byPlan {
		m[k] = v
	}
	return &PlanPolicies{byPlan: m, fallback: fallback}
}

// For returns the policy for a plan, or the fallback for unknown plans. A nil
// receiver yields the zero Policy (no constraints).
func (p *PlanPolicies) For(plan string) Policy {
	if p == nil {
		return Policy{}
	}
	if pol, ok := p.byPlan[plan]; ok {
		return pol
	}
	return p.fallback
}

// contains reports whether id is in ids.
func contains(ids []string, id string) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}
