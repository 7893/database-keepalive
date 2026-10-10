package db

import (
	"context"
	"encoding/json"
	"github.com/7893/database-keepalive/internal/config"
	"github.com/DATA-DOG/go-sqlmock"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPConfigPageSize(t *testing.T) {
	for _, kind := range []string{"supabase", "adb"} {
		t.Run(kind, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if kind == "supabase" {
					if r.URL.Query().Get("limit") != "25" || r.URL.Query().Get("offset") != "50" {
						t.Error("wrong supabase page range")
					}
					w.Header().Set("Content-Range", "50-74/76")
					w.Write([]byte(`[]`))
					return
				}
				var body map[string]string
				json.NewDecoder(r.Body).Decode(&body)
				var rows any = []any{}
				if strings.Contains(body["statementText"], "COUNT(*)") {
					rows = []any{map[string]int{"cnt": 76}}
				} else if !strings.Contains(body["statementText"], "OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY") {
					t.Error("wrong Oracle page range")
				}
				json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{"statementId": 1, "resultSet": map[string]any{"items": rows}}}})
			}))
			defer srv.Close()
			m := config.DefaultModel()
			m.Display.PageSize = 25
			c := config.Config{Model: m, Env: map[string]string{"SUPABASE_URL": srv.URL, "ADB_URL": srv.URL, "SUPABASE_SECRET_KEY": "test-secret"}}
			b, e := newBackend(kind, c)
			if e != nil {
				t.Fatal(e)
			}
			result, e := b.Query(context.Background(), 3)
			if e != nil || result.Limit != 25 || result.TotalPages != 4 || result.Page != 3 || result.Count != 76 {
				t.Fatalf("result=%+v err=%v", result, e)
			}
		})
	}
}
func TestSQLCustomPageSize(t *testing.T) {
	for _, kind := range []string{"mysql", "db2"} {
		t.Run(kind, func(t *testing.T) {
			pool, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer pool.Close()
			m.ExpectBegin()
			if kind == "db2" {
				m.ExpectExec("SET CURRENT ISOLATION RR").WillReturnResult(sqlmock.NewResult(0, 0))
			}
			m.ExpectQuery("SELECT COUNT").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(76))
			q := m.ExpectQuery("SELECT .*ORDER BY ping_time DESC,id DESC")
			if kind == "db2" {
				q.WithArgs(50, 25)
			} else {
				q.WithArgs(25, 50)
			}
			q.WillReturnRows(sqlmock.NewRows([]string{"id", "ping_time", "status", "colo", "country", "city", "region", "ip"}))
			m.ExpectRollback()
			s := &SQLStore{Pool: pool, Kind: kind}
			s.SetPageSize(25)
			result, e := s.Query(context.Background(), 3)
			if e != nil || result.Limit != 25 || result.TotalPages != 4 {
				t.Fatalf("result=%+v error=%v", result, e)
			}
			if e := m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestRegistryCreatesOnlyEnabledAdapters(t *testing.T) {
	m, e := config.Parse([]byte(`{"database_types":{"supabase":true},"instances":[{"id":"active","type":"supabase","env_prefix":"ACTIVE"},{"id":"native_disabled","type":"db2","env_prefix":"OFF"}]}`))
	if e != nil {
		t.Fatal(e)
	}
	r, e := NewRegistry(config.Config{Model: m, Env: map[string]string{"ACTIVE_URL": "https://test.example", "ACTIVE_SECRET_KEY": "test-secret"}})
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	if len(r.Backends) != 1 || r.Backends["active"] == nil {
		t.Fatal("disabled driver initialized")
	}
}
