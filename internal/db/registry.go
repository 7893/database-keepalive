package db

import (
	"context"
	"fmt"
	"io"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/geo"
)

type Registry struct {
	Backends map[string]Backend
	Config   config.Config
	Cache    *Cache
}

func NewRegistry(c config.Config) (*Registry, error) {
	r := &Registry{Config: c, Cache: NewCache(), Backends: map[string]Backend{}}
	r.Backends["supabase"] = NewSupabase(c.Get("SUPABASE_URL"), c.Get("SUPABASE_SECRET_KEY"))
	for _, region := range []string{"US", "JP"} {
		prefix := "OCI_ADB_" + region
		r.Backends[map[string]string{"US": "adb_us", "JP": "adb_jp"}[region]] = NewOracle(c.Get(prefix+"_URL"), c.Get(prefix+"_USER"), c.Get(prefix+"_PASS"))
	}
	mysql, e := NewMySQL(c)
	if e != nil {
		return nil, e
	}
	r.Backends["mysql_jp"] = mysql
	db2, e := NewDb2(c)
	if e != nil {
		r.Close()
		return nil, e
	}
	r.Backends["db2"] = db2
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
	s, _ := config.Find(id)
	return r.Config.Missing(s.Required)
}
func (r *Registry) Ping(ctx context.Context, id, requestID string, g geo.Geo) error {
	defer r.Cache.Invalidate(id)
	if missing := r.Missing(id); len(missing) > 0 {
		return fmt.Errorf("configuration_error")
	}
	b := r.Backends[id]
	if b == nil {
		return fmt.Errorf("configuration_error")
	}
	return b.Ping(ctx, requestID, g)
}
func (r *Registry) Query(ctx context.Context, id string, page int) Result {
	if missing := r.Missing(id); len(missing) > 0 {
		return Result{Rows: []Row{}, Page: 1, Limit: PageSize, TotalPages: 1, Error: "configuration_error", Missing: missing}
	}
	return r.Cache.Read(ctx, id, page, func() Result {
		b := r.Backends[id]
		if b == nil {
			return Failure(page, fmt.Errorf("missing_backend"))
		}
		result, e := b.Query(ctx, page)
		if e != nil {
			return Failure(page, e)
		}
		return result
	})
}
