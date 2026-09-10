package provider

import "context"

// ProviderType identifies the category of a provider.
type ProviderType string

const (
	TypeAvatar   ProviderType = "avatar"
	TypeVoice    ProviderType = "voice"
	TypeSTT      ProviderType = "stt"
	TypeLLM      ProviderType = "llm"
	TypeTTS      ProviderType = "tts"
	TypeCommerce ProviderType = "commerce"
	TypeBilling  ProviderType = "billing"
)

// HealthStatus represents the health of a provider.
type HealthStatus struct {
	Status    string `json:"status"` // "healthy", "degraded", "unhealthy"
	LatencyMs int64  `json:"latency_ms"`
	Detail    string `json:"detail,omitempty"`
}

// Capabilities describes what a provider can do.
type Capabilities struct {
	Streaming             bool              `json:"streaming"`
	MaxConcurrentSessions int               `json:"max_concurrent_sessions,omitempty"`
	Languages             []string          `json:"languages,omitempty"`
	Features              map[string]bool   `json:"features,omitempty"`
}

// Provider is the base interface all provider adapters implement.
// The router uses this to evaluate and select providers without
// knowing their concrete implementation.
type Provider interface {
	// ID returns the unique provider instance identifier.
	ID() string
	// Name returns the human-readable provider name (e.g. "heygen-prod-1").
	Name() string
	// Type returns the provider category.
	Type() ProviderType
	// Health checks the provider's current status.
	Health(ctx context.Context) (HealthStatus, error)
	// Capabilities advertises what this provider supports.
	Capabilities() (Capabilities, error)
	// CostPerUnit returns the cost in microdollars for one unit of the given resource.
	CostPerUnit(resourceType string) (int64, error)
	// AvgLatencyMs returns the recent average latency in milliseconds.
	AvgLatencyMs() int64
	// SuccessRate returns the recent success rate (0.0 to 1.0).
	SuccessRate() float64
}

// Registry holds all registered providers and supports lookup by type.
type Registry struct {
	providers map[string]Provider // keyed by provider ID
}

// NewRegistry creates an empty provider registry.
func NewRegistry() *Registry {
	return &Registry{providers: make(map[string]Provider)}
}

// Register adds a provider to the registry.
func (r *Registry) Register(p Provider) {
	r.providers[p.ID()] = p
}

// Get returns a provider by ID.
func (r *Registry) Get(id string) (Provider, bool) {
	p, ok := r.providers[id]
	return p, ok
}

// ByType returns all providers of the given type.
func (r *Registry) ByType(t ProviderType) []Provider {
	var result []Provider
	for _, p := range r.providers {
		if p.Type() == t {
			result = append(result, p)
		}
	}
	return result
}

// All returns all registered providers.
func (r *Registry) All() []Provider {
	result := make([]Provider, 0, len(r.providers))
	for _, p := range r.providers {
		result = append(result, p)
	}
	return result
}
