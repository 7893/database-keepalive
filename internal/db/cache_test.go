package db

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
)

func TestCacheCoalescesAndInvalidates(t *testing.T) {
	c := NewCache()
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	load := func() Result {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return Successful(nil, 0, 1)
	}
	var wg sync.WaitGroup
	wg.Go(func() { c.Read(context.Background(), "db2", 1, load) })
	<-started
	for range 10 {
		wg.Go(func() { c.Read(context.Background(), "db2", 1, load) })
	}
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("duplicate upstream reads")
	}
	c.Invalidate("db2")
	c.Read(context.Background(), "db2", 1, load)
	if calls.Load() != 2 {
		t.Fatal("stale cache retained")
	}
}
func TestInvalidationDuringFlightCannotRestoreOldEntry(t *testing.T) {
	c := NewCache()
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		c.Read(context.Background(), "db2", 1, func() Result { close(started); <-release; return Successful(nil, 1, 1) })
		close(done)
	}()
	<-started
	c.Invalidate("db2")
	fresh := c.Read(context.Background(), "db2", 1, func() Result { return Successful(nil, 2, 1) })
	close(release)
	<-done
	got := c.Read(context.Background(), "db2", 1, func() Result { t.Error("fresh cache discarded"); return Result{} })
	if got.Count != fresh.Count {
		t.Fatal("stale read restored")
	}
}
func TestFailedReadsAreNotCached(t *testing.T) {
	c := NewCache()
	calls := 0
	for range 2 {
		c.Read(context.Background(), "db2", 1, func() Result { calls++; return Failure(1, context.DeadlineExceeded) })
	}
	if calls != 2 {
		t.Fatal("failure cached")
	}
}
