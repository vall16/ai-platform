// Package quota tracks active concurrent sessions per provider so the router
// can skip providers that have reached their capacity (quota-aware routing).
package quota

import "sync"

// Store is the shared capacity-tracking contract used by the scoring engine.
// Implementations may be in-memory (single instance) or backed by a shared
// store such as Redis. With a shared store, every router instance coordinates
// through the same counter, so a provider's MaxConcurrentSessions is enforced
// globally across the whole fleet rather than per-instance — this is what makes
// the router horizontally scalable (stateless).
type Store interface {
	// Active returns the number of currently active sessions for a provider.
	Active(id string) int
	// TryAcquire atomically reserves one session slot for a provider, up to
	// limit. A limit <= 0 means unlimited. Returns false when the limit is
	// already reached.
	TryAcquire(id string, limit int) bool
	// Release frees one session slot previously reserved for a provider.
	Release(id string)
}

// Tracker is a thread-safe in-memory per-provider concurrent session counter.
// It satisfies Store and is the default for single-instance deployments and
// tests.
type Tracker struct {
	mu     sync.Mutex
	active map[string]int
	peak   map[string]int
}

// NewTracker creates an empty capacity tracker.
func NewTracker() *Tracker {
	return &Tracker{active: make(map[string]int), peak: make(map[string]int)}
}

// Active returns the current active session count for a provider.
func (t *Tracker) Active(id string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.active[id]
}

// TryAcquire atomically reserves one session slot for a provider if it is
// under the limit. A limit <= 0 means unlimited and always succeeds. It
// returns false if the provider is at or over its limit.
func (t *Tracker) TryAcquire(id string, limit int) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if limit > 0 && t.active[id] >= limit {
		return false
	}
	t.active[id]++
	if t.active[id] > t.peak[id] {
		t.peak[id] = t.active[id]
	}
	return true
}

// Release frees one session slot for a provider.
func (t *Tracker) Release(id string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.active[id] > 0 {
		t.active[id]--
	}
}

// Peak returns the high-water mark of active sessions observed for a provider
// since the tracker was created. It is an observability aid used by load tests
// to assert the "never over-allocate" invariant under concurrency.
func (t *Tracker) Peak(id string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.peak[id]
}

// SetLoad seeds the active count for a provider (used for warm start and tests).
func (t *Tracker) SetLoad(id string, load int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if load < 0 {
		load = 0
	}
	t.active[id] = load
	if t.active[id] > t.peak[id] {
		t.peak[id] = t.active[id]
	}
}
