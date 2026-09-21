// Package quota tracks active concurrent sessions per provider so the router
// can skip providers that have reached their capacity (quota-aware routing).
package quota

import "sync"

// Tracker tracks active concurrent sessions per provider against a limit.
type Tracker struct {
	mu     sync.Mutex
	active map[string]int
}

// NewTracker creates an empty capacity tracker.
func NewTracker() *Tracker {
	return &Tracker{active: make(map[string]int)}
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

// SetLoad seeds the active count for a provider (used for warm start and tests).
func (t *Tracker) SetLoad(id string, load int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if load < 0 {
		load = 0
	}
	t.active[id] = load
}
