// Package resilience provides a per-provider circuit breaker used by the
// router to stop sending traffic to a provider that is failing repeatedly,
// and to probe it again once it has had time to recover.
package resilience

import (
	"sync"
	"time"
)

// State is the state of a circuit breaker.
type State int

const (
	// StateClosed allows all traffic; failures are counted.
	StateClosed State = iota
	// StateOpen rejects traffic until OpenDuration elapses.
	StateOpen
	// StateHalfOpen allows probe traffic to test for recovery.
	StateHalfOpen
)

// String returns a human-readable form of the state.
func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half_open"
	default:
		return "unknown"
	}
}

// Config configures a circuit breaker.
type Config struct {
	// FailureThreshold is the number of failures within Window that trips the
	// breaker from closed to open.
	FailureThreshold int
	// Window is the sliding window over which failures are counted.
	Window time.Duration
	// OpenDuration is how long the breaker stays open before allowing a
	// half-open probe.
	OpenDuration time.Duration
}

// DefaultConfig returns a sensible default configuration.
func DefaultConfig() Config {
	return Config{
		FailureThreshold: 5,
		Window:           60 * time.Second,
		OpenDuration:     30 * time.Second,
	}
}

// Breaker is a thread-safe circuit breaker for a single provider.
type Breaker struct {
	cfg Config

	mu       sync.Mutex
	state    State
	failures []time.Time // timestamps of recent failures (within Window)
	openedAt time.Time
}

// NewBreaker creates a breaker with the given config, applying defaults for
// any zero/negative fields.
func NewBreaker(cfg Config) *Breaker {
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 5
	}
	if cfg.Window <= 0 {
		cfg.Window = 60 * time.Second
	}
	if cfg.OpenDuration <= 0 {
		cfg.OpenDuration = 30 * time.Second
	}
	return &Breaker{cfg: cfg, state: StateClosed}
}

// Allow reports whether a request may be sent through the breaker.
func (b *Breaker) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.allowLocked(time.Now())
}

func (b *Breaker) allowLocked(now time.Time) bool {
	switch b.state {
	case StateClosed:
		return true
	case StateOpen:
		if now.Sub(b.openedAt) >= b.cfg.OpenDuration {
			b.state = StateHalfOpen
			return true // allow a probe
		}
		return false
	case StateHalfOpen:
		// Allow probe traffic; a success closes the circuit, a failure re-opens it.
		return true
	default:
		return true
	}
}

// RecordSuccess records a successful call. In half-open this closes the circuit.
func (b *Breaker) RecordSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == StateHalfOpen {
		b.state = StateClosed
	}
	b.failures = nil
}

// RecordFailure records a failed call and may trip the breaker open.
func (b *Breaker) RecordFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	b.failures = append(b.failures, now)

	// Drop failures that fell out of the sliding window.
	cutoff := now.Add(-b.cfg.Window)
	kept := b.failures[:0]
	for _, t := range b.failures {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	b.failures = kept

	switch b.state {
	case StateClosed:
		if len(b.failures) >= b.cfg.FailureThreshold {
			b.tripLocked(now)
		}
	case StateHalfOpen:
		// A failed probe re-opens the circuit.
		b.tripLocked(now)
	}
}

func (b *Breaker) tripLocked(now time.Time) {
	b.state = StateOpen
	b.openedAt = now
	b.failures = nil
}

// State returns the current breaker state, reflecting the time-based
// open→half-open transition without mutating state.
func (b *Breaker) State() State {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state == StateOpen && time.Now().Sub(b.openedAt) >= b.cfg.OpenDuration {
		return StateHalfOpen
	}
	return b.state
}

// Store is the shared circuit-breaker contract used by the scoring engine.
// Implementations may be in-memory (single instance) or backed by a shared
// store such as Redis. With a shared store, a breaker that trips on one router
// instance is visible to every other instance, so the whole fleet stops sending
// traffic to a failing provider together — again making the router stateless.
type Store interface {
	// Allow reports whether a request may be sent to the provider.
	Allow(id string) bool
	// RecordSuccess records a successful call for the provider.
	RecordSuccess(id string)
	// RecordFailure records a failed call for the provider.
	RecordFailure(id string)
}

// Manager holds one breaker per provider ID. It satisfies Store and is the
// default for single-instance deployments and tests.
type Manager struct {
	cfg      Config
	mu       sync.Mutex
	breakers map[string]*Breaker
}

// NewManager creates a breaker manager using the given config for all breakers.
func NewManager(cfg Config) *Manager {
	return &Manager{cfg: cfg, breakers: make(map[string]*Breaker)}
}

// For returns the breaker for a provider, creating it on first use.
func (m *Manager) For(id string) *Breaker {
	m.mu.Lock()
	defer m.mu.Unlock()
	br, ok := m.breakers[id]
	if !ok {
		br = NewBreaker(m.cfg)
		m.breakers[id] = br
	}
	return br
}

// Allow reports whether a request may be sent to the provider, satisfying the
// Store interface.
func (m *Manager) Allow(id string) bool { return m.For(id).Allow() }

// RecordSuccess records a success on the provider's breaker.
func (m *Manager) RecordSuccess(id string) { m.For(id).RecordSuccess() }

// RecordFailure records a failure on the provider's breaker.
func (m *Manager) RecordFailure(id string) { m.For(id).RecordFailure() }
