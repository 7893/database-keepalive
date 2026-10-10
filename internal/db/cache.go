package db

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"
)

type cached struct {
	expires time.Time
	ready   chan struct{}
	result  Result
}
type Cache struct {
	mu      sync.Mutex
	entries map[string]*cached
}

func NewCache() *Cache { return &Cache{entries: map[string]*cached{}} }
func (c *Cache) Read(ctx context.Context, service string, page int, load func() Result) Result {
	key := service + ":" + strconv.Itoa(page)
	c.mu.Lock()
	if hit := c.entries[key]; hit != nil && hit.expires.After(time.Now()) {
		c.mu.Unlock()
		select {
		case <-hit.ready:
			return hit.result
		case <-ctx.Done():
			return Failure(page, ctx.Err())
		}
	}
	if len(c.entries) >= 100 {
		for k := range c.entries {
			delete(c.entries, k)
			break
		}
	}
	entry := &cached{expires: time.Now().Add(time.Minute), ready: make(chan struct{})}
	c.entries[key] = entry
	c.mu.Unlock()
	result := load()
	c.mu.Lock()
	entry.result = result
	if !result.OK && c.entries[key] == entry {
		delete(c.entries, key)
	}
	close(entry.ready)
	c.mu.Unlock()
	return result
}
func (c *Cache) Invalidate(service string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for key := range c.entries {
		if strings.HasPrefix(key, service+":") {
			delete(c.entries, key)
		}
	}
}
