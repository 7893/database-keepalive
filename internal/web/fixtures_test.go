package web

import (
	"context"
	"errors"
	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/geo"
	"net/http"
	"net/http/httptest"
	"sync"
)

type call struct {
	ID  string
	Geo geo.Geo
}
type fake struct {
	mu       sync.Mutex
	calls    []call
	reads    []int
	failures int
}

func (f *fake) Ping(_ context.Context, id string, g geo.Geo) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call{id, g})
	if f.failures > 0 {
		f.failures--
		return errors.New("temporary")
	}
	return nil
}
func (f *fake) Query(_ context.Context, page int) (db.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reads = append(f.reads, page)
	return db.Successful([]db.Row{{Status: "SUCCESS", PingTime: "2026-10-10T00:00:00Z", Geo: geo.Geo{Colo: "NRT", Country: "JP", City: "<img src=x onerror=alert(1)>", IP: "203.0.113.42"}}}, 21, page), nil
}
func (f *fake) Clean(context.Context, string) (map[string]any, error) {
	return map[string]any{"ok": true}, nil
}
func fixture() (*Handler, map[string]*fake) {
	c := config.Config{Env: map[string]string{"TRIGGER_SECRET": "test-admin", "SCHEDULER_TOKEN": "test-scheduler", "PUBLIC_ORIGIN": "https://database-keepalive.test"}}
	backends := map[string]db.Backend{}
	fakes := map[string]*fake{}
	for _, s := range config.DefaultModel().Instances {
		for _, key := range s.Required {
			c.Env[key] = "test-value"
		}
		f := &fake{}
		fakes[s.ID] = f
		backends[s.ID] = f
	}
	h := New(&db.Registry{Config: c, Backends: backends, Cache: db.NewCache()})
	h.Delay = func(context.Context, int) error { return nil }
	return h, fakes
}
func request(h *Handler, method, path, token string, headers map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "https://database-keepalive.test"+path, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

type rewrite struct{ base string }

func (t rewrite) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	u := httptest.NewRequest("GET", t.base, nil).URL
	clone.URL = u
	return http.DefaultTransport.RoundTrip(clone)
}
