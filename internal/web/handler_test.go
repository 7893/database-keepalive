package web

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/7893/database-keepalive/internal/scheduler"
)

func TestAdministrativeRoutesFailClosed(t *testing.T) {
	h, fakes := fixture()
	for _, path := range []string{"/trigger", "/debug", "/internal/tick", "/internal/checkin"} {
		method := "POST"
		if path == "/debug" {
			method = "GET"
		}
		if w := request(h, method, path, "", nil); w.Code != 401 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	for _, v := range []struct {
		method, path string
		status       int
	}{{"GET", "/trigger", 405}, {"POST", "/trigger?target=unknown", 400}, {"POST", "/trigger?mode=unknown", 400}, {"POST", "/admin/clean?action=repair", 404}, {"DELETE", "/api/clean?action=delete", 404}, {"GET", "/api/data?service=unknown", 400}} {
		if w := request(h, v.method, v.path, "test-admin", nil); w.Code != v.status {
			t.Fatalf("%s: got %d", v.path, w.Code)
		}
	}
	for _, f := range fakes {
		if len(f.calls) != 0 {
			t.Fatal("unauthorized or invalid call wrote")
		}
	}
	h.Registry.Config.Env["TRIGGER_SECRET"] = ""
	if w := request(h, "POST", "/trigger", "", nil); w.Code != 503 {
		t.Fatal("missing authentication did not fail closed")
	}
}
func TestEmptyAndInvalidTicksDoNotContactDatabases(t *testing.T) {
	h, fakes := fixture()
	headers := map[string]string{"X-Database-Keepalive-Scheduler": "test-scheduler"}
	for _, stamp := range []string{"", "invalid", "2026-02-29T00:00:00Z"} {
		headers["X-CloudScheduler-ScheduleTime"] = stamp
		if request(h, "POST", "/internal/tick", "", headers).Code != 400 {
			t.Fatal("invalid time accepted")
		}
	}
	m := h.Registry.Config.Catalog()
	plan, _ := (scheduler.Planner{Services: m.Instances, Policy: m.Schedule}).Daily("2026-10-10")
	stamp := "2026-10-09T16:00:00.000Z"
	for _, e := range plan {
		if e.PlannedAt == stamp {
			t.Fatal("fixture minute must be empty")
		}
	}
	headers["X-CloudScheduler-ScheduleTime"] = stamp
	w := request(h, "POST", "/internal/tick", "", headers)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"results":{}`) {
		t.Fatal("empty tick failed")
	}
	for _, f := range fakes {
		if len(f.calls)+len(f.reads) != 0 {
			t.Fatal("empty tick contacted database")
		}
	}
}
func TestSchedulerRetriesSamePayloadAndOnlyDueDatabase(t *testing.T) {
	h, fakes := fixture()
	m := h.Registry.Config.Catalog()
	plan, _ := (scheduler.Planner{Services: m.Instances, Policy: m.Schedule}).Daily("2020-01-01")
	entry := plan[0]
	fakes[entry.Service].failures = 2
	headers := map[string]string{"X-Database-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": entry.PlannedAt}
	for range 2 {
		if w := request(h, "POST", "/internal/tick", "", headers); w.Code != 200 {
			t.Fatal("retry failed")
		}
	}
	for id, f := range fakes {
		if id != entry.Service {
			if len(f.calls) > 0 {
				t.Fatal("wrong database written")
			}
			continue
		}
		if len(f.calls) != 4 {
			t.Fatal("wrong retry count")
		}
		for _, c := range f.calls {
			if c != f.calls[0] {
				t.Fatal("retry identity changed")
			}
		}
	}
}
func TestRemovedModesCannotWriteAndManualRedirect(t *testing.T) {
	h, fakes := fixture()
	for _, mode := range []string{"simulated", "random", "real", "client", ""} {
		if w := request(h, "POST", "/trigger?mode="+mode, "test-admin", nil); w.Code != 400 {
			t.Fatal("removed geographic parameter accepted")
		}
	}
	for _, f := range fakes {
		if len(f.calls) != 0 {
			t.Fatal("removed modes wrote records")
		}
	}
	if w := request(h, "POST", "/trigger?target=db2", "test-admin", map[string]string{"Accept": "text/html"}); w.Code != 303 || w.Header().Get("Location") != "https://database-keepalive.test" {
		t.Fatal("redirect changed")
	}
	if len(fakes["db2"].calls) != 1 {
		t.Fatal("manual target not written")
	}
}

func TestPageOrderHistoryAndAliases(t *testing.T) {
	h, fakes := fixture()
	w := request(h, "GET", "/?supabase_p=2&sb_p=9&us_p=3&adb_jp_p=4&db2_p=5&mysql_jp_p=6", "", nil)
	if w.Code != 200 {
		t.Fatal("page failed")
	}
	body := w.Body.String()
	previous := -1
	for _, id := range []string{"supabase", "db2", "adb_us", "mysql_jp", "adb_jp"} {
		index := strings.Index(body, `class="card" id="card-`+id+`"`)
		if index <= previous {
			t.Fatal("page order changed")
		}
		previous = index
	}
	for id, page := range map[string]int{"supabase": 2, "adb_us": 3, "adb_jp": 4, "db2": 5, "mysql_jp": 6} {
		if fakes[id].reads[0] != page {
			t.Fatal("pagination alias changed")
		}
	}
	if strings.Contains(body, "geo-locations") || strings.Contains(body, "IP Address") || !strings.Contains(body, "Ubuntu") || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("geographic UI remains or lost font/security headers")
	}
	w = request(h, "GET", "/api/data?service=supabase", "", nil)
	var r struct {
		Rows []map[string]any `json:"rows"`
	}
	if json.Unmarshal(w.Body.Bytes(), &r) != nil || r.Rows[0]["id"] != float64(42) {
		t.Fatal("history data lost")
	}
	for _, field := range []string{"colo", "country", "city", "region", "ip"} {
		if _, ok := r.Rows[0][field]; ok {
			t.Fatal("geographic field exposed")
		}
	}
}
