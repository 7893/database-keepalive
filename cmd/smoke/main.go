// Read-only verification of a deployed public dashboard.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: smoke URL")
		os.Exit(1)
	}
	base := strings.TrimRight(os.Args[1], "/")
	u, e := url.Parse(base)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		fail("invalid service URL")
	}
	client := &http.Client{Timeout: 120 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	check := func(method, path string, status int) []byte {
		req, e := http.NewRequest(method, base+path, nil)
		if e != nil {
			fail("invalid request")
		}
		resp, e := client.Do(req)
		if e != nil {
			fail("service unavailable")
		}
		defer resp.Body.Close()
		body, e := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		if e != nil || resp.StatusCode != status {
			fail("unexpected response: " + path)
		}
		return body
	}
	page := check("GET", "/", 200)
	if !strings.Contains(string(page), "Database Keepalive") {
		fail("unexpected page")
	}
	check("GET", "/debug", 401)
	check("POST", "/trigger", 401)
	check("POST", "/internal/tick", 401)
	var catalog struct {
		Services []struct {
			ID string `json:"id"`
		} `json:"services"`
	}
	if json.Unmarshal(check("GET", "/api/services", 200), &catalog) != nil || len(catalog.Services) == 0 {
		fail("no enabled database instances")
	}
	for _, service := range catalog.Services {
		id := service.ID
		var result struct {
			OK   bool              `json:"ok"`
			Rows []json.RawMessage `json:"rows"`
		}
		if json.Unmarshal(check("GET", "/api/data?service="+url.QueryEscape(id), 200), &result) != nil || !result.OK {
			fail("database unavailable: " + id)
		}
	}
	fmt.Printf("Read-only health checks passed for the dashboard and %d database instances.\n", len(catalog.Services))
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
