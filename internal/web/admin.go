package web

import (
	"net/http"
	"strings"
	"sync"

	"github.com/7893/database-keepalive/internal/random"
)

func (h *Handler) trigger(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, "POST") || !authorize(w, r, h.Registry.Config.Get("TRIGGER_SECRET")) {
		return
	}
	target := first(r.URL.Query().Get("target"), "all")
	targets := []string{}
	if target == "all" {
		for _, s := range h.Registry.Config.Services() {
			targets = append(targets, s.ID)
		}
	} else if _, ok := h.Registry.Config.Find(target); ok {
		targets = append(targets, target)
	} else {
		failure(w, 400, "invalid_target", "Unknown database target.")
		return
	}
	if r.URL.Query().Has("mode") {
		failure(w, 400, "unsupported_parameter", "Geographic modes are no longer supported.")
		return
	}
	missing := []string{}
	seen := map[string]bool{}
	for _, target := range targets {
		for _, key := range h.Registry.Missing(target) {
			if !seen[key] {
				missing = append(missing, key)
				seen[key] = true
			}
		}
	}
	if len(missing) > 0 {
		respond(w, 503, map[string]any{"success": false, "error": "configuration_error", "missing": missing})
		return
	}
	results := map[string]bool{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, target := range targets {
		wg.Go(func() {
			ok := h.Registry.Ping(r.Context(), target, random.UUID()) == nil
			mu.Lock()
			results[target] = ok
			mu.Unlock()
		})
	}
	wg.Wait()
	success := true
	for _, ok := range results {
		success = success && ok
	}
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		secure(w, false)
		w.Header().Set("Location", origin(h.Registry.Config.Get("PUBLIC_ORIGIN")))
		w.WriteHeader(303)
		return
	}
	status := 200
	if !success {
		status = 502
	}
	respond(w, status, map[string]any{"success": success, "results": results})
}
