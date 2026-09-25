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

// Mode describes the quality tier of the selected provider, expressing how far
// the routing decision degraded from the ideal (top-scored) provider.
type Mode string

const (
	// ModeFull: the top-scored provider was selected (no degradation).
	ModeFull Mode = "full"
	// ModeDegraded: a fallback within the normal cascade was selected.
	ModeDegraded Mode = "degraded"
	// ModeBestEffort: no primary provider was eligible, so the designated
	// best-effort safety net was selected to keep serving (degraded response).
	ModeBestEffort Mode = "best_effort"
)

// Result is the output of a routing decision.
type Result struct {
	SelectedProviderID string      `json:"selected_provider_id"`
	Score              float64     `json:"score"`
	Candidates         []Candidate `json:"candidates"`
	Reason             string      `json:"reason"`
	Failover           bool        `json:"failover"`
	Mode               Mode        `json:"mode"`
	DegradationLevel   int         `json:"degradation_level"`
}

// Engine scores providers and selects the best available one for a given
// resource type, applying health, circuit-breaker and quota gates and failing
// over to the next-best candidate when the top one is unavailable.
type Engine struct {
	registry   *provider.Registry
	weights    Weights
	breakers   resilience.Store
	tracker    quota.Store
	bestEffort provider.Provider
}

// NewEngine creates a scoring engine with the given registry, circuit-breaker
// store and capacity store. breakers or tracker may be nil to disable the
// corresponding gate. Both stores may be shared across many engine instances
// (e.g. one per router replica) to coordinate quota and circuit-breaker state
// horizontally; pass an in-memory store for a single-instance deployment.
func NewEngine(reg *provider.Registry, breakers resilience.Store, tracker quota.Store) *Engine {
	return &Engine{
		registry: reg,
		weights:  DefaultWeights,
		breakers: breakers,
		tracker:  tracker,
	}
}

// SetWeights overrides the scoring weights.
func (e *Engine) SetWeights(w Weights) { e.weights = w }

// SetBestEffort designates a last-resort provider used for graceful
// degradation: when no primary provider is eligible (all unhealthy,
// circuit-open or over quota), the engine falls back to this provider — if it
// is itself healthy — and serves a degraded response instead of failing.
func (e *Engine) SetBestEffort(p provider.Provider) { e.bestEffort = p }

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
		if e.breakers != nil && !e.breakers.Allow(p.ID()) {
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

	// trySelect reserves a quota slot for the candidate. On failure it marks
	// the candidate over-quota and returns false so the caller can fall through.
	trySelect := func(ev *eval) bool {
		if e.tracker != nil {
			caps, _ := ev.provider.Capabilities()
			limit := caps.MaxConcurrentSessions
			if limit > 0 && !e.tracker.TryAcquire(ev.provider.ID(), limit) {
				// Lost a race for the last slot; fall through to the next candidate.
				ev.cand.Eligible = false
				ev.cand.SkipReason = "over_quota"
				return false
			}
		}
		return true
	}

	// Failover: reserve the first eligible candidate's quota slot.
	var selected *eval
	var selectedIdx int
	isBestEffort := false
	for i := range evals {
		if !evals[i].cand.Eligible {
			continue
		}
		if trySelect(&evals[i]) {
			selected = &evals[i]
			selectedIdx = i
			break
		}
	}

	// Graceful degradation: if no primary provider is eligible, fall back to
	// the designated best-effort provider (if healthy) instead of failing.
	if selected == nil && e.bestEffort != nil {
		if health, err := e.bestEffort.Health(ctx); err == nil && health.Status != "unhealthy" {
			be := eval{
				provider: e.bestEffort,
				cand: Candidate{
					ProviderID: e.bestEffort.ID(),
					Name:       e.bestEffort.Name(),
					Score:      round4(e.scoreProvider(e.bestEffort)),
					Eligible:   true,
				},
			}
			if trySelect(&be) {
				evals = append(evals, be)
				selected = &evals[len(evals)-1]
				selectedIdx = len(evals) - 1
				isBestEffort = true
			}
		}
	}

	if selected == nil {
		return nil, fmt.Errorf("no available providers for type %s", resourceType)
	}

	resultCandidates := make([]Candidate, 0, len(evals))
	for i := range evals {
		resultCandidates = append(resultCandidates, evals[i].cand)
	}

	mode := ModeFull
	degradationLevel := 0
	switch {
	case isBestEffort:
		mode = ModeBestEffort
		degradationLevel = selectedIdx
	case selectedIdx > 0:
		mode = ModeDegraded
		degradationLevel = selectedIdx
	}
	failover := mode != ModeFull

	reason := fmt.Sprintf("highest eligible score (weights cost=%.2f, latency=%.2f, reliability=%.2f)",
		e.weights.Cost, e.weights.Latency, e.weights.Reliability)
	switch mode {
	case ModeDegraded:
		reason = fmt.Sprintf("graceful degradation: top candidate unavailable, selected fallback at level %d", degradationLevel)
	case ModeBestEffort:
		reason = "graceful degradation: no primary provider available, using best-effort fallback"
	}

	return &Result{
		SelectedProviderID: selected.cand.ProviderID,
		Score:              selected.cand.Score,
		Candidates:         resultCandidates,
		Reason:             reason,
		Failover:           failover,
		Mode:               mode,
		DegradationLevel:   degradationLevel,
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
