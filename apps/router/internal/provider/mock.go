package provider

import (
	"context"
	"fmt"
)

// MockProvider is a deterministic mock implementation for development and testing.
// It simulates a provider with configurable cost, latency, and reliability.
type MockProvider struct {
	id          string
	name        string
	typ         ProviderType
	costPerUnit int64 // microdollars
	latencyMs   int64
	successRate float64
	healthy     bool
}

// MockProviderConfig configures a MockProvider instance.
type MockProviderConfig struct {
	ID          string
	Name        string
	Type        ProviderType
	CostPerUnit int64
	LatencyMs   int64
	SuccessRate float64
}

// NewMockProvider creates a mock provider with the given config.
func NewMockProvider(cfg MockProviderConfig) *MockProvider {
	if cfg.SuccessRate == 0 {
		cfg.SuccessRate = 0.99
	}
	return &MockProvider{
		id:          cfg.ID,
		name:        cfg.Name,
		typ:         cfg.Type,
		costPerUnit: cfg.CostPerUnit,
		latencyMs:   cfg.LatencyMs,
		successRate: cfg.SuccessRate,
		healthy:     true,
	}
}

func (m *MockProvider) ID() string { return m.id }
func (m *MockProvider) Name() string { return m.name }
func (m *MockProvider) Type() ProviderType { return m.typ }

func (m *MockProvider) Health(_ context.Context) (HealthStatus, error) {
	status := "healthy"
	if !m.healthy {
		status = "unhealthy"
	}
	return HealthStatus{
		Status:    status,
		LatencyMs: m.latencyMs,
		Detail:    fmt.Sprintf("mock provider %s", m.name),
	}, nil
}

func (m *MockProvider) Capabilities() (Capabilities, error) {
	return Capabilities{
		Streaming:             true,
		MaxConcurrentSessions: 100,
		Languages:             []string{"en", "it"},
		Features:              map[string]bool{"barge_in": true},
	}, nil
}

func (m *MockProvider) CostPerUnit(_ string) (int64, error) {
	return m.costPerUnit, nil
}

func (m *MockProvider) AvgLatencyMs() int64 { return m.latencyMs }
func (m *MockProvider) SuccessRate() float64 { return m.successRate }

// SetHealthy toggles the mock's health status (for failover testing).
func (m *MockProvider) SetHealthy(healthy bool) {
	m.healthy = healthy
}
