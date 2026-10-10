package web

import (
	"encoding/json"
	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/scheduler"
	"strings"
	"testing"
)

func TestEnabledTypesApplyToEveryRoute(t *testing.T) {
	h, fakes := fixture()
	m := config.DefaultModel()
	m.Types = map[string]bool{"adb": true}
	h.Registry.Config.Model = m
	page := request(h, "GET", "/", "", nil)
	if page.Code != 200 || strings.Contains(page.Body.String(), `id="card-supabase"`) || strings.Contains(page.Body.String(), `id="card-db2"`) || !strings.Contains(page.Body.String(), `id="card-adb_jp"`) {
		t.Fatal("disabled cards rendered")
	}
	meta := request(h, "GET", "/api/services", "", nil)
	var catalog struct {
		Services []struct {
			ID string `json:"id"`
		} `json:"services"`
	}
	if json.Unmarshal(meta.Body.Bytes(), &catalog) != nil || len(catalog.Services) != 2 {
		t.Fatal("catalog includes disabled instance")
	}
	for _, private := range []string{"test-value", "env_prefix", "OCI_ADB", "tunnel_prefix"} {
		if strings.Contains(meta.Body.String(), private) {
			t.Fatal("private settings exposed")
		}
	}
	if request(h, "GET", "/api/data?service=db2", "", nil).Code != 400 || request(h, "POST", "/trigger?target=db2", "test-admin", nil).Code != 400 {
		t.Fatal("disabled single target accepted")
	}
	if request(h, "POST", "/trigger", "test-admin", nil).Code != 200 {
		t.Fatal("enabled operations failed")
	}
	plan, _ := (scheduler.Planner{Services: m.Instances, Policy: m.Schedule}).Daily("2026-10-11")
	for _, entry := range plan {
		if entry.Service == "adb_jp" || entry.Service == "adb_us" {
			continue
		}
		w := request(h, "POST", "/internal/tick", "", map[string]string{"X-Database-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": entry.PlannedAt})
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"results":{}`) {
			t.Fatal("disabled scheduled slot dispatched")
		}
		break
	}
	for _, id := range []string{"supabase", "db2", "mysql_jp"} {
		if len(fakes[id].calls)+len(fakes[id].reads) != 0 {
			t.Fatal("disabled database contacted")
		}
	}
}
func TestConfiguredAttemptsAndPaginationFailure(t *testing.T) {
	h, fakes := fixture()
	m := config.DefaultModel()
	m.Schedule.Attempts = 2
	m.Display.PageSize = 25
	h.Registry.Config.Model = m
	plan, _ := (scheduler.Planner{Services: m.Instances, Policy: m.Schedule}).Daily("2026-10-11")
	entry := plan[0]
	fakes[entry.Service].failures = 3
	w := request(h, "POST", "/internal/tick", "", map[string]string{"X-Database-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": entry.PlannedAt})
	if w.Code != 502 || len(fakes[entry.Service].calls) != 2 {
		t.Fatal("configured retry count ignored")
	}
	delete(h.Registry.Config.Env, "SUPABASE_SECRET_KEY")
	w = request(h, "GET", "/api/data?service=supabase", "", nil)
	if w.Code != 503 || !strings.Contains(w.Body.String(), `"limit":25`) {
		t.Fatal("failed response ignored page size")
	}
	m.Display.Fonts = []string{"Roboto", "Ubuntu", "sans-serif"}
	m.Display.RefreshSeconds = 60
	w = request(h, "GET", "/", "", nil)
	if !strings.Contains(w.Body.String(), `"fonts":["Roboto","Ubuntu","sans-serif"]`) || !strings.Contains(w.Body.String(), `"refresh_seconds":60`) {
		t.Fatal("display settings not delivered")
	}
}
func TestCustomInstanceIDWorksWithoutFixedRegions(t *testing.T) {
	h, fakes := fixture()
	m, e := config.Parse([]byte(`{"database_types":{"adb":true},"instances":[{"id":"lunar","type":"adb","region":"Moon","env_prefix":"LUNAR"}]}`))
	if e != nil {
		t.Fatal(e)
	}
	h.Registry.Config.Model = m
	h.Registry.Backends["lunar"] = fakes["adb_us"]
	for key, value := range map[string]string{"LUNAR_URL": "https://moon.example", "LUNAR_USER": "test-user", "LUNAR_PASS": "test-secret"} {
		h.Registry.Config.Env[key] = value
	}
	for _, path := range []string{"/", "/api/data?service=lunar&page=2"} {
		if request(h, "GET", path, "", nil).Code != 200 {
			t.Fatal("custom ID unavailable")
		}
	}
	if request(h, "POST", "/trigger?target=lunar", "test-admin", nil).Code != 200 {
		t.Fatal("custom ID manual ping failed")
	}
	plan, _ := (scheduler.Planner{Services: m.Instances, Policy: m.Schedule}).Daily("2026-10-11")
	if request(h, "POST", "/internal/tick", "", map[string]string{"X-Database-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": plan[0].PlannedAt}).Code != 200 {
		t.Fatal("custom ID scheduled ping failed")
	}
}

func TestLegacySchedulerHeaderRemainsValidDuringMigration(t *testing.T) {
	h, _ := fixture()
	w := request(h, "POST", "/internal/tick", "", map[string]string{"X-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": "2026-10-09T16:00:00Z"})
	if w.Code != 200 {
		t.Fatal("old scheduler header rejected during migration")
	}
}
