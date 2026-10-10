package web

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/db"
	"github.com/7893/keepalive/internal/geo"
	"github.com/7893/keepalive/internal/scheduler"
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
	c := config.Config{"TRIGGER_SECRET": "test-admin", "SCHEDULER_TOKEN": "test-scheduler", "PUBLIC_ORIGIN": "https://keepalive.test"}
	backends := map[string]db.Backend{}
	fakes := map[string]*fake{}
	for _, s := range config.Services {
		for _, key := range s.Required {
			c[key] = "test-value"
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
	r := httptest.NewRequest(method, "https://keepalive.test"+path, nil)
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
func TestAdministrativeRoutesFailClosed(t *testing.T) {
	h, fakes := fixture()
	for _, path := range []string{"/trigger", "/admin/clean?action=repair", "/api/clean?action=repair", "/debug", "/internal/tick", "/internal/checkin"} {
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
	}{{"GET", "/trigger", 405}, {"POST", "/trigger?target=unknown", 400}, {"POST", "/trigger?mode=unknown", 400}, {"POST", "/admin/clean?action=delete", 400}, {"DELETE", "/api/clean?action=delete", 200}, {"GET", "/api/data?service=unknown", 400}} {
		if w := request(h, v.method, v.path, "test-admin", nil); w.Code != v.status {
			t.Fatalf("%s: got %d", v.path, w.Code)
		}
	}
	for _, f := range fakes {
		if len(f.calls) != 0 {
			t.Fatal("unauthorized or invalid call wrote")
		}
	}
	h.Registry.Config["TRIGGER_SECRET"] = ""
	if w := request(h, "POST", "/trigger", "", nil); w.Code != 503 {
		t.Fatal("missing authentication did not fail closed")
	}
}
func TestEmptyAndInvalidTicksDoNotContactDatabases(t *testing.T) {
	h, fakes := fixture()
	headers := map[string]string{"X-Keepalive-Scheduler": "test-scheduler"}
	for _, stamp := range []string{"", "invalid", "2026-02-29T00:00:00Z"} {
		headers["X-CloudScheduler-ScheduleTime"] = stamp
		if request(h, "POST", "/internal/tick", "", headers).Code != 400 {
			t.Fatal("invalid time accepted")
		}
	}
	plan, _ := scheduler.Daily("2026-10-10")
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
	plan, _ := scheduler.Daily("2020-01-01")
	entry := plan[0]
	fakes[entry.Service].failures = 2
	headers := map[string]string{"X-Keepalive-Scheduler": "test-scheduler", "X-CloudScheduler-ScheduleTime": entry.PlannedAt}
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
				t.Fatal("retry identity or geography changed")
			}
		}
	}
}
func TestGeographicModesAndRedirect(t *testing.T) {
	h, fakes := fixture()
	for _, mode := range []string{"simulated", "random"} {
		if w := request(h, "POST", "/trigger?mode="+mode, "test-admin", nil); w.Code != 200 {
			t.Fatal("mode lost")
		}
		seen := map[string]bool{}
		for _, f := range fakes {
			g := f.calls[len(f.calls)-1].Geo
			if seen[g.Colo] {
				t.Fatal("shared simulated location")
			}
			seen[g.Colo] = true
		}
	}
	before := len(fakes["db2"].calls)
	if w := request(h, "POST", "/trigger?mode=client", "test-admin", map[string]string{"CF-Connecting-IP": "203.0.113.2", "CF-IPCountry": "JP"}); w.Code != 502 {
		t.Fatal("forged geographic headers trusted")
	}
	if len(fakes["db2"].calls) != before {
		t.Fatal("unavailable geography wrote")
	}
	trace := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ip=198.51.100.1\ncolo=SIN\nloc=SG\n")) }))
	defer trace.Close()
	h.Client = &http.Client{Transport: rewrite{trace.URL}}
	if w := request(h, "POST", "/trigger?mode=real", "test-admin", nil); w.Code != 200 {
		t.Fatal("real mode failed")
	}
	for _, f := range fakes {
		g := f.calls[len(f.calls)-1].Geo
		if g.Colo != "SIN" || g.IP != "198.51.100.1" {
			t.Fatal("real mode substituted location")
		}
	}
	if w := request(h, "POST", "/trigger?target=db2", "test-admin", map[string]string{"Accept": "text/html"}); w.Code != 303 || w.Header().Get("Location") != "https://keepalive.test" {
		t.Fatal("redirect changed")
	}
}

type rewrite struct{ base string }

func (t rewrite) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	u := httptest.NewRequest("GET", t.base, nil).URL
	clone.URL = u
	return http.DefaultTransport.RoundTrip(clone)
}
func TestPageOrderEscapingPrivacyAndAliases(t *testing.T) {
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
	if strings.Contains(body, "<img src=x") || strings.Contains(body, "203.0.113.42") || !strings.Contains(body, "203.0.113.xxx") || !strings.Contains(body, "Ubuntu") || w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("unsafe rendering or lost font")
	}
	w = request(h, "GET", "/api/data?service=supabase", "", nil)
	var r db.Result
	if json.Unmarshal(w.Body.Bytes(), &r) != nil || r.Rows[0].IP != "203.0.113.xxx" {
		t.Fatal("API privacy lost")
	}
	w = request(h, "GET", "/debug", "test-admin", nil)
	if !strings.Contains(w.Body.String(), "203.0.113.42") {
		t.Fatal("authorized debug lost full data")
	}
}
