package resilience

import (
	"context"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/ai-platform/router/internal/redis"
)

// failSeq makes ZSET members unique even when two failures share a timestamp.
var failSeq uint64

// RedisStore is a resilience.Store backed by a shared Redis instance. The
// breaker state (closed/open/half_open), the open timestamp, and the sliding
// window of failure timestamps are stored in Redis so every router instance
// observes the same breaker state: a breaker that trips on one instance is
// visible to the whole fleet.
//
// Failure mode: if Redis is unreachable the store fails OPEN (Allow returns
// true), degrading to standalone behavior rather than blocking all traffic.
type RedisStore struct {
	conn    redis.Conn
	cfg     Config
	prefix  string
	timeout time.Duration
}

// NewRedisStore creates a Redis-backed circuit-breaker store. prefix namespaces
// the keys (default "router:cb:"); timeout bounds each round trip (default 2s).
func NewRedisStore(conn redis.Conn, cfg Config, prefix string, timeout time.Duration) *RedisStore {
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 5
	}
	if cfg.Window <= 0 {
		cfg.Window = 60 * time.Second
	}
	if cfg.OpenDuration <= 0 {
		cfg.OpenDuration = 30 * time.Second
	}
	if prefix == "" {
		prefix = "router:cb:"
	}
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	return &RedisStore{conn: conn, cfg: cfg, prefix: prefix, timeout: timeout}
}

func (s *RedisStore) stateKey(id string) string  { return s.prefix + id + ":state" }
func (s *RedisStore) openedAtKey(id string) string { return s.prefix + id + ":opened_at" }
func (s *RedisStore) failKey(id string) string    { return s.prefix + id + ":failures" }

// Allow reports whether a request may be sent to the provider.
func (s *RedisStore) Allow(id string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	switch s.getState(ctx, id) {
	case "open":
		openedAt := s.getOpenedAt(ctx, id)
		if time.Since(openedAt) >= s.cfg.OpenDuration {
			// Open duration elapsed: transition to half-open and allow a probe.
			s.setState(ctx, id, "half_open")
			return true
		}
		return false
	default: // closed or half_open
		return true
	}
}

// RecordSuccess records a successful call; in half-open it closes the circuit.
func (s *RedisStore) RecordSuccess(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	if s.getState(ctx, id) == "half_open" {
		s.setState(ctx, id, "closed")
	}
	_, _ = s.conn.Do(ctx, "DEL", s.failKey(id))
}

// RecordFailure records a failed call and may trip the breaker open.
func (s *RedisStore) RecordFailure(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	now := time.Now()
	ts := strconv.FormatInt(now.UnixNano(), 10)
	member := ts + "-" + strconv.FormatUint(atomic.AddUint64(&failSeq, 1), 10)
	_, _ = s.conn.Do(ctx, "ZADD", s.failKey(id), ts, member)

	// Drop failures that fell out of the sliding window.
	cutoff := now.Add(-s.cfg.Window).UnixNano()
	_, _ = s.conn.Do(ctx, "ZREMRANGEBYSCORE", s.failKey(id), "0", strconv.FormatInt(cutoff, 10))

	r, err := s.conn.Do(ctx, "ZCARD", s.failKey(id))
	if err != nil {
		return
	}
	count, _ := r.AsInt()

	switch s.getState(ctx, id) {
	case "closed":
		if count >= int64(s.cfg.FailureThreshold) {
			s.trip(ctx, id, now)
		}
	case "half_open":
		s.trip(ctx, id, now)
	}
}

func (s *RedisStore) trip(ctx context.Context, id string, now time.Time) {
	s.setState(ctx, id, "open")
	_, _ = s.conn.Do(ctx, "SET", s.openedAtKey(id), strconv.FormatInt(now.UnixNano(), 10))
	_, _ = s.conn.Do(ctx, "DEL", s.failKey(id))
}

func (s *RedisStore) getState(ctx context.Context, id string) string {
	r, err := s.conn.Do(ctx, "GET", s.stateKey(id))
	if err != nil || r.Null {
		return "closed"
	}
	str, _ := r.AsString()
	return str
}

func (s *RedisStore) setState(ctx context.Context, id, state string) {
	_, _ = s.conn.Do(ctx, "SET", s.stateKey(id), state)
}

func (s *RedisStore) getOpenedAt(ctx context.Context, id string) time.Time {
	r, err := s.conn.Do(ctx, "GET", s.openedAtKey(id))
	if err != nil || r.Null {
		return time.Time{}
	}
	str, _ := r.AsString()
	n, err := strconv.ParseInt(str, 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.Unix(0, n)
}
