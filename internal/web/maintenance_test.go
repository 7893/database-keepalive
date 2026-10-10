package web

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/geo"
)

type maintenanceBackend struct {
	reads, cleans int
	fail          bool
}

func (b *maintenanceBackend) Ping(context.Context, string, geo.Geo) error { return nil }
func (b *maintenanceBackend) Query(context.Context, int) (db.Result, error) {
	b.reads++
	return db.Successful(nil, 0, 1), nil
}
func (b *maintenanceBackend) Clean(context.Context, string) (map[string]any, error) {
	b.cleans++
	if b.fail {
		return nil, errors.New("private_credentials_in_error")
	}
	return map[string]any{"ok": true}, nil
}
func TestMaintenanceTargetsAndPartialFailureInvalidateCache(t *testing.T) {
	for _, route := range []string{"/admin/clean", "/api/clean"} {
		for _, action := range []string{"repair", "delete"} {
			t.Run(route+action, func(t *testing.T) {
				cfg := config.Config{Env: map[string]string{"TRIGGER_SECRET": "test-token"}}
				registry := &db.Registry{Config: cfg, Cache: db.NewCache(), Backends: map[string]db.Backend{}}
				stores := map[string]*maintenanceBackend{}
				for _, s := range config.DefaultModel().Instances {
					for _, key := range s.Required {
						cfg.Env[key] = "test-value"
					}
					b := &maintenanceBackend{fail: s.ID == "supabase"}
					stores[s.ID] = b
					registry.Backends[s.ID] = b
					registry.Query(context.Background(), s.ID, 1)
				}
				method := http.MethodPost
				if action == "delete" {
					method = http.MethodDelete
				}
				req := httptest.NewRequest(method, route+"?action="+action, nil)
				req.Header.Set("Authorization", "Bearer test-token")
				response := httptest.NewRecorder()
				New(registry).ServeHTTP(response, req)
				if response.Code != 502 || strings.Contains(response.Body.String(), "private_credentials") {
					t.Fatal("unsafe maintenance failure")
				}
				for _, id := range []string{"supabase", "adb_us", "adb_jp"} {
					registry.Query(context.Background(), id, 1)
					if stores[id].cleans != 1 || stores[id].reads != 2 {
						t.Fatalf("cache or target failure: %s", id)
					}
				}
				for _, id := range []string{"db2", "mysql_jp"} {
					registry.Query(context.Background(), id, 1)
					if stores[id].cleans != 0 || stores[id].reads != 1 {
						t.Fatalf("unexpected maintenance: %s", id)
					}
				}
			})
		}
	}
}
