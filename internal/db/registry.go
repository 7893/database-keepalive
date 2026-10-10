package db

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/7893/database-keepalive/internal/config"
)

type Registry struct {
	Backends map[string]Backend
	Config   config.Config
	Cache    *Cache
}

func NewRegistry(c config.Config) (*Registry, error) {
	r := &Registry{Config: c, Cache: NewCache(time.Duration(c.Catalog().Runtime.CacheSeconds) * time.Second), Backends: map[string]Backend{}}
	for _, s := range c.Services() {
		b, e := newBackend(s.Type, c.Connection(s))
		if e != nil {
			r.Close()
			return nil, e
		}
		r.Backends[s.ID] = b
	}
	return r, nil
}
func (r *Registry) Close() {
	for _, b := range r.Backends {
		if closer, ok := b.(io.Closer); ok {
			closer.Close()
		}
	}
}
func (r *Registry) Missing(id string) []string {
	s, _ := r.Config.Find(id)
	return r.Config.Missing(s.Required)
}
func (r *Registry) Ping(ctx context.Context, id, requestID string) error {
	defer r.Cache.Invalidate(id)
	if missing := r.Missing(id); len(missing) > 0 {
		return fmt.Errorf("configuration_error")
	}
	b := r.Backends[id]
	if b == nil {
		return fmt.Errorf("configuration_error")
	}
	return b.Ping(ctx, requestID)
}
func (r *Registry) Query(ctx context.Context, id string, page int) Result {
	limit := r.Config.Catalog().Display.PageSize
	failure := func(e error) Result {
		result := Failure(page, e)
		result.Limit = limit
		return result
	}
	if missing := r.Missing(id); len(missing) > 0 {
		return Result{Rows: []Row{}, Page: 1, Limit: limit, TotalPages: 1, Error: "configuration_error", Missing: missing}
	}
	result := r.Cache.Read(ctx, id, page, func() Result {
		b := r.Backends[id]
		if b == nil {
			return failure(fmt.Errorf("missing_backend"))
		}
		result, e := b.Query(ctx, page)
		if e != nil {
			return failure(e)
		}
		return result
	})
	if !result.OK {
		result.Limit = limit
	}
	return result
}
