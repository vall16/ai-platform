package resilience

import (
	"testing"
	"time"
)

func TestBreakerOpensAfterThreshold(t *testing.T) {
	b := NewBreaker(Config{FailureThreshold: 3, Window: time.Minute, OpenDuration: time.Hour})
	for i := 0; i < 2; i++ {
		b.RecordFailure()
	}
	if !b.Allow() {
		t.Fatalf("breaker should stay closed below threshold")
	}
	b.RecordFailure()
	if b.State() != StateOpen {
		t.Fatalf("expected open after threshold, got %s", b.State())
	}
	if b.Allow() {
		t.Fatalf("open breaker should deny traffic")
	}
}

func TestBreakerHalfOpenAndRecover(t *testing.T) {
	b := NewBreaker(Config{FailureThreshold: 1, Window: time.Minute, OpenDuration: 20 * time.Millisecond})
	b.RecordFailure()
	if b.State() != StateOpen {
		t.Fatalf("expected open, got %s", b.State())
	}
	time.Sleep(30 * time.Millisecond)
	if !b.Allow() {
		t.Fatalf("expected half-open to allow a probe")
	}
	b.RecordSuccess()
	if b.State() != StateClosed {
		t.Fatalf("expected closed after successful probe, got %s", b.State())
	}
}

func TestBreakerHalfOpenFailureReopens(t *testing.T) {
	b := NewBreaker(Config{FailureThreshold: 1, Window: time.Minute, OpenDuration: 20 * time.Millisecond})
	b.RecordFailure()
	time.Sleep(30 * time.Millisecond)
	b.Allow() // transition to half-open
	b.RecordFailure()
	if b.State() != StateOpen {
		t.Fatalf("expected open after failed probe, got %s", b.State())
	}
}

func TestBreakerWindowPrunesOldFailures(t *testing.T) {
	b := NewBreaker(Config{FailureThreshold: 3, Window: 30 * time.Millisecond, OpenDuration: time.Hour})
	b.RecordFailure()
	b.RecordFailure()
	time.Sleep(40 * time.Millisecond) // first two fall out of the window
	b.RecordFailure()
	if b.State() != StateClosed {
		t.Fatalf("expected closed (old failures pruned), got %s", b.State())
	}
}

func TestManagerSharesBreakerPerID(t *testing.T) {
	m := NewManager(Config{FailureThreshold: 1, Window: time.Minute, OpenDuration: time.Hour})
	m.RecordFailure("p")
	if m.For("p").State() != StateOpen {
		t.Fatalf("expected breaker for p to be open")
	}
	if m.For("other").State() != StateClosed {
		t.Fatalf("expected breaker for other to be closed")
	}
}
