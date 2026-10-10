package db

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/7893/keepalive/internal/geo"
)

var testGeo = geo.Geo{Colo: "NRT", Country: "JP", City: "Tokyo", Region: "Kanto", IP: "203.0.113.2"}

const testID = "11111111-1111-4111-a111-111111111111"

func TestSupabaseCommittedReceipt(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		match bool
	}{{"matching", true}, {"mismatched", false}} {
		t.Run(scenario.name, func(t *testing.T) {
			writes := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					writes++
					if r.URL.Query().Get("on_conflict") != "request_id" || !strings.Contains(r.Header.Get("Prefer"), "ignore-duplicates") {
						t.Error("idempotency missing")
					}
					w.WriteHeader(201)
					return
				}
				receipt := Row{RequestID: testID, Status: "SUCCESS", Geo: testGeo}
				if !scenario.match {
					receipt.City = "Osaka"
				}
				json.NewEncoder(w).Encode([]Row{receipt})
			}))
			defer srv.Close()
			s := NewSupabase(srv.URL, "test-secret")
			for range 2 {
				e := s.Ping(context.Background(), testID, testGeo)
				if (e == nil) != scenario.match {
					t.Fatal("incorrect receipt acceptance")
				}
			}
			if writes != 2 {
				t.Fatal("request count changed")
			}
		})
	}
}
func TestOracleRejectsSQLFailuresInsideHTTP200(t *testing.T) {
	bodies := []string{`{}`, `{"items":[]}`, `{"items":[{"statementId":1,"errorDetails":"ORA-00942"}]}`, `{"items":[{"statementId":1,"resultSet":{"items":[]}}]}`}
	for _, body := range bodies {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		s := NewOracle(srv.URL, "u", "p")
		if _, e := s.Query(context.Background(), 1); e == nil {
			t.Fatal("malformed SQL result accepted")
		}
		srv.Close()
	}
}
func TestOracleDuplicateRequiresMatchingPayload(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]string
		json.NewDecoder(r.Body).Decode(&payload)
		sql := payload["statementText"]
		if strings.HasPrefix(sql, "SELECT") {
			receipt := Row{RequestID: testID, Status: "SUCCESS", Geo: testGeo}
			receipt.City = "Osaka"
			json.NewEncoder(w).Encode(map[string]any{"items": []any{map[string]any{"statementId": 1, "resultSet": map[string]any{"items": []Row{receipt}}}}})
			return
		}
		if !strings.Contains(sql, "DUP_VAL_ON_INDEX") || !strings.Contains(sql, testID) {
			t.Error("idempotency missing")
		}
		fmt.Fprint(w, `{"items":[{"statementId":1}]}`)
	}))
	defer srv.Close()
	if e := NewOracle(srv.URL, "u", "p").Ping(context.Background(), testID, testGeo); e == nil {
		t.Fatal("conflicting payload accepted")
	}
}
func TestHTTPDeadlineIncludesResponseBodyAndRejectsRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/unexpected", 302)
			return
		}
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		select {
		case <-time.After(time.Second):
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()
	s := httpStore{client: HTTPClient()}
	s.client.Timeout = 20 * time.Millisecond
	if _, _, _, e := s.request(context.Background(), "GET", srv.URL, nil, nil); e == nil {
		t.Fatal("body read ignored timeout")
	}
	if _, _, _, e := s.request(context.Background(), "GET", srv.URL+"/redirect", nil, nil); e == nil {
		t.Fatal("credential redirect accepted")
	}
}
