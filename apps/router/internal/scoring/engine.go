package scoring

import (
	"context"
	"fmt"
	"sort"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/resilience"
)

// Weights for the scoring formula. Must sum to 1.0.
type Weights struct {
	Cost        float64
	Latency     float64
	Reliability float64
}

// DefaultWeights is the default scoring configuration.
var DefaultWeights = Weights{
	Cost:        0.4,
	Latency:     0.3,
	Reliability: 0.3,
}

// Candidate is a provider evaluated by the scoring engine.
type Candidate struct {
	ProviderID string  `json:"provider_id"`
	Name       string  `json:"name"`
	Score      float64 `json:"score"`
	Eligible   bool    `json:"eligible"`
	SkipReason string  `json:"skip_reason,omitempty"` // "unhealthy", "circuit_open", "over_quota"
}

// Result is the output of a routing decision.
type Result struct {
	SelectedProviderID string      `json:"selected_provider_id"`
	Score              float64     `json:"score"`
	Candidates         []Candidate `json:"candidates"`
	Reason             string      `json:"reason"`
	Failover           bool        `json:"failover"`
}

// Engine scores providers and selects the best available one for a given
// resource type, applying health, circuit-breaker and quota gates and failing
// over to the next-best candidate when the top one is unavailable.
type Engine struct {
	registry *provider.Registry
	weights  Weights
	breakers *resilience.Manager
	tracker  *quota.Tracker
}

// NewEngine creates a scoring engine with the given registry, circuit-breaker
// manager and capacity tracker. breakers or tracker may be nil to disable the
// corresponding gate.
func NewEngine(reg *provider.Registry, breakers *resilience.Manager, tracker *quota.Tracker) *Engine {
	return &Engine{
		registry: reg,
		weights:  DefaultWeights,
		breakers: breakers,
		tracker:  tracker,
	}
}

// SetWeights overrides the scoring weights.
func (e *Engine) SetWeights(w Weights) { e.weights = w }

// RecordOutcome feeds a call outcome back into the circuit breaker for a
// provider, driving its open/half-open/closed transitions.
func (e *Engine) RecordOutcome(providerID string, success bool) {
	if e.breakers == nil {
		return
	}
	if success {
		e.breakers.RecordSuccess(providerID)
	} else {
		e.breakers.RecordFailure(providerID)
	}
}

// Release frees a session slot previously reserved for a provider.
func (e *Engine) Release(providerID string) {
	if e.tracker != nil {
		e.tracker.Release(providerID)
	}
}

// Route evaluates all providers of the given type and returns the best
// available candidate, failing over to the next-best when the top one is
// unhealthy, circuit-open or over quota.
func (e *Engine) Route(ctx context.Context, resourceType provider.ProviderType) (*Result, error) {
	candidates := e.registry.ByType(resourceType)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no providers registered for type %s", resourceType)
	}

	type eval struct {
		provider provider.Provider
		cand     Candidate
	}
	evals := make([]eval, 0, len(candidates))

	for _, p := range candidates {
		c := Candidate{
			ProviderID: p.ID(),
			Name:       p.Name(),
			Score:      round4(e.scoreProvider(p)),
			Eligible:   true,
		}

		// Health gate.
		health, err := p.Health(ctx)
		if err != nil || health.Status == "unhealthy" {
			c.Eligible = false
			c.SkipReason = "unhealthy"
			evals = append(evals, eval{provider: p, cand: c})
			continue
		}

		// Circuit-breaker gate.
		if e.breakers != nil && !e.breakers.For(p.ID()).Allow() {
			c.Eligible = false
			c.SkipReason = "circuit_open"
			evals = append(evals, eval{provider: p, cand: c})
			continue
		}

		// Quota gate (peek; the slot is reserved atomically on selection).
		if e.tracker != nil {
			caps, _ := p.Capabilities()
			if caps.MaxConcurrentSessions > 0 && e.tracker.Active(p.ID()) >= caps.MaxConcurrentSessions {
				c.Eligible = false
				c.SkipReason = "over_quota"
				evals = append(evals, eval{provider: p, cand: c})
				continue
			}
		}

		evals = append(evals, eval{provider: p, cand: c})
	}

	// Sort by score, best first.
	sort.SliceStable(evals, func(i, j int) bool {
		return evals[i].cand.Score > evals[j].cand.Score
	})

	// Failover: reserve the first eligible candidate's quota slot.
	var selected *eval
	for i := range evals {
		if !evals[i].cand.Eligible {
			continue
		}
		if e.tracker != nil {
			caps, _ := evals[i].provider.Capabilities()
			limit := caps.MaxConcurrentSessions
			if limit > 0 && !e.tracker.TryAcquire(evals[i].provider.ID(), limit) {
				// Lost a race for the last slot; fall through to the next candidate.
				evals[i].cand.Eligible = false
				evals[i].cand.SkipReason = "over_quota"
				continue
			}
		}
		selected = &evals[i]
		break
	}

	if selected == nil {
		return nil, fmt.Errorf("no available providers for type %s", resourceType)
	}

	resultCandidates := make([]Candidate, 0, len(evals))
	failover := false
	for i := range evals {
		resultCandidates = append(resultCandidates, evals[i].cand)
		if evals[i].cand.ProviderID == selected.cand.ProviderID && i > 0 {
			failover = true
		}
	}

	reason := fmt.Sprintf("highest eligible score (weights cost=%.2f, latency=%.2f, reliability=%.2f)",
		e.weights.Cost, e.weights.Latency, e.weights.Reliability)
	if failover {
		reason = "failover: top candidate unavailable, selected next eligible provider"
	}

	return &Result{
		SelectedProviderID: selected.cand.ProviderID,
		Score:              selected.cand.Score,
		Candidates:         resultCandidates,
		Reason:             reason,
		Failover:           failover,
	}, nil
}

// scoreProvider computes a composite score in [0, 1] where higher is better.
func (e *Engine) scoreProvider(p provider.Provider) float64 {
	// Cost score: lower cost → higher score.
	// Normalize: assume max reasonable cost is 1_000_000 microdollars ($1).
	cost, _ := p.CostPerUnit("default")
	maxCost := int64(1_000_000)
	if cost <= 0 {
		cost = 1
	}
	costScore := 1.0 - float64(cost)/float64(maxCost)
	if costScore < 0 {
		costScore = 0
	}

	// Latency score: lower latency → higher score.
	// Normalize: assume max reasonable latency is 5000ms.
	latency := p.AvgLatencyMs()
	maxLatency := int64(5000)
	if latency <= 0 {
		latency = 1
	}
	latencyScore := 1.0 - float64(latency)/float64(maxLatency)
	if latencyScore < 0 {
		latencyScore = 0
	}

	// Reliability score: the success rate itself (0.0 to 1.0).
	reliabilityScore := p.SuccessRate()

	return e.weights.Cost*costScore +
		e.weights.Latency*latencyScore +
		e.weights.Reliability*reliabilityScore
}

func round4(f float64) float64 {
	return float64(int(f*10000)) / 10000
}
