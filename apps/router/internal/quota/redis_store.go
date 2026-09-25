package quota

import (
	"context"
	"strconv"
	"time"

	"github.com/ai-platform/router/internal/redis"
)

// RedisStore is a quota.Store backed by a shared Redis instance. Every router
// instance that shares the same Redis coordinates through the same counter, so
// a provider's MaxConcurrentSessions is enforced fleet-wide rather than
// per-instance.
//
// The acquire is an atomic INCR followed by a compensating DECR when the limit
// is exceeded. Because INCR is atomic and monotonic, the active count can never
// exceed the limit: the (limit+1)-th INCR returns limit+1, is detected as over,
// and is rolled back. No Lua script is required.
//
// Failure mode: if Redis is unreachable the store fails OPEN (Active reports 0
// and TryAcquire succeeds), degrading to standalone single-instance behavior
// rather than blocking all routing.
type RedisStore struct {
	conn    redis.Conn
	prefix  string
	timeout time.Duration
}

// NewRedisStore creates a Redis-backed quota store. prefix namespaces the keys
// (default "router:quota:"); timeout bounds each round trip (default 2s).
func NewRedisStore(conn redis.Conn, prefix string, timeout time.Duration) *RedisStore {
	if prefix == "" {
		prefix = "router:quota:"
	}
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	return &RedisStore{conn: conn, prefix: prefix, timeout: timeout}
}

func (s *RedisStore) key(id string) string { return s.prefix + id }

// Active returns the current active session count for a provider.
func (s *RedisStore) Active(id string) int {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	r, err := s.conn.Do(ctx, "GET", s.key(id))
	if err != nil || r.Null {
		return 0
	}
	str, err := r.AsString()
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return n
}

// TryAcquire atomically reserves one session slot for a provider, up to limit.
// A limit <= 0 means unlimited and always succeeds.
func (s *RedisStore) TryAcquire(id string, limit int) bool {
	if limit <= 0 {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	r, err := s.conn.Do(ctx, "INCR", s.key(id))
	if err != nil {
		return true // fail-open: keep routing if the shared store is down
	}
	cur, _ := r.AsInt()
	if cur > int64(limit) {
		// Over the limit; roll back the slot we just took.
		c2, cancel2 := context.WithTimeout(context.Background(), s.timeout)
		defer cancel2()
		_, _ = s.conn.Do(c2, "DECR", s.key(id))
		return false
	}
	return true
}

// Release frees one session slot previously reserved for a provider.
func (s *RedisStore) Release(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	_, _ = s.conn.Do(ctx, "DECR", s.key(id))
}
