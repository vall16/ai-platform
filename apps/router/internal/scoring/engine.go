package scoring

import (
	"context"
	"fmt"

	"github.com/ai-platform/router/internal/provider"
)

// Weights for the scoring formula. Must sum to 1.0.
var DefaultWeights = struct {
	Cost       float64
	Latency    float64
	Reliability float64
}{
	Cost:       0.4,
	Latency:    0.3,
	Reliability: 0.3,
}

// Candidate is a provider evaluated by the scoring engine.
type Candidate struct {
	ProviderID string  `json:"provider_id"`
	Name       string  `json:"name"`
	Score      float64 `json:"score"`
	Reason     string  `json:"reason,omitempty"`
}

// Result is the output of a routing decision.
type Result struct {
	SelectedProviderID string      `json:"selected_provider_id"`
	Score              float64     `json:"score"`
	Candidates         []Candidate `json:"candidates"`
	Reason             string      `json:"reason"`
}

// Engine scores providers and selects the best one for a given resource type.
type Engine struct {
	registry *provider.Registry
	weights  struct {
		Cost       float64
		Latency    float64
		Reliability float64
	}
}

// NewEngine creates a scoring engine with the given registry and default weights.
func NewEngine(reg *provider.Registry) *Engine {
	return &Engine{
		registry: reg,
		weights:  DefaultWeights,
	}
}

// SetWeights overrides the scoring weights.
func (e *Engine) SetWeights(w struct {
	Cost       float64
	Latency    float64
	Reliability float64
}) {
	e.weights = w
}

// Route evaluates all providers of the given type and returns the best candidate.
func (e *Engine) Route(ctx context.Context, resourceType provider.ProviderType) (*Result, error) {
	candidates := e.registry.ByType(resourceType)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no providers registered for type %s", resourceType)
	}

	scored := make([]Candidate, 0, len(candidates))
	var best *Candidate

	for _, p := range candidates {
		health, err := p.Health(ctx)
		if err != nil || health.Status == "unhealthy" {
			continue
		}

		score := e.scoreProvider(p)
		c := Candidate{
			ProviderID: p.ID(),
			Name:       p.Name(),
			Score:      round4(score),
		}
		scored = append(scored, c)

		if best == nil || score > best.Score {
			scored[len(scored)-1] = c
			best = &scored[len(scored)-1]
		}
	}

	if best == nil {
		return nil, fmt.Errorf("no healthy providers available for type %s", resourceType)
	}

	return &Result{
		SelectedProviderID: best.ProviderID,
		Score:              best.Score,
		Candidates:         scored,
		Reason:             fmt.Sprintf("highest composite score (cost=%.2f, latency=%.2f, reliability=%.2f)",
			e.weights.Cost, e.weights.Latency, e.weights.Reliability),
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
