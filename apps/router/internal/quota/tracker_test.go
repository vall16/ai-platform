package quota

import "testing"

func TestTryAcquireRespectsLimit(t *testing.T) {
	tk := NewTracker()
	if !tk.TryAcquire("p", 2) {
		t.Fatal("first acquire should succeed")
	}
	if !tk.TryAcquire("p", 2) {
		t.Fatal("second acquire should succeed")
	}
	if tk.TryAcquire("p", 2) {
		t.Fatal("third acquire should fail at limit")
	}
	if tk.Active("p") != 2 {
		t.Fatalf("expected active=2, got %d", tk.Active("p"))
	}
}

func TestUnlimitedWhenLimitZero(t *testing.T) {
	tk := NewTracker()
	for i := 0; i < 100; i++ {
		if !tk.TryAcquire("p", 0) {
			t.Fatalf("unlimited acquire %d should succeed", i)
		}
	}
}

func TestReleaseFreesSlot(t *testing.T) {
	tk := NewTracker()
	tk.TryAcquire("p", 1)
	if tk.TryAcquire("p", 1) {
		t.Fatal("should be at limit")
	}
	tk.Release("p")
	if !tk.TryAcquire("p", 1) {
		t.Fatal("should acquire after release")
	}
}

func TestReleaseDoesNotGoNegative(t *testing.T) {
	tk := NewTracker()
	tk.Release("p")
	if tk.Active("p") != 0 {
		t.Fatalf("expected 0, got %d", tk.Active("p"))
	}
}

func TestSetLoadSeedsCount(t *testing.T) {
	tk := NewTracker()
	tk.SetLoad("p", 5)
	if tk.Active("p") != 5 {
		t.Fatalf("expected 5, got %d", tk.Active("p"))
	}
	if tk.TryAcquire("p", 5) {
		t.Fatal("should be at limit after SetLoad")
	}
}
