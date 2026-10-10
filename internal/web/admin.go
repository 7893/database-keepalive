package web

import (
	"net/http"
	"strings"
	"sync"

	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/geo"
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
	mode := first(r.URL.Query().Get("mode"), "simulated")
	if mode == "random" {
		mode = "simulated"
	}
	if mode != "simulated" && mode != "real" && mode != "client" {
		failure(w, 400, "invalid_mode", "Unknown geographic mode.")
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
	geos := []geo.Geo{}
	if mode == "simulated" {
		geos = geo.Distinct(len(targets), geo.Random)
	} else {
		var g geo.Geo
		var e error
		if mode == "real" {
			g, e = geo.Real(r.Context(), h.Client)
		} else {
			g, e = geo.Client(r.Context())
		}
		if e != nil {
			failure(w, 502, mode+"_geo_unavailable", "Requested geographic data is unavailable.")
			return
		}
		for range targets {
			geos = append(geos, g)
		}
	}
	results := map[string]bool{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i, target := range targets {
		wg.Go(func() {
			ok := h.Registry.Ping(r.Context(), target, geo.UUID(), geos[i]) == nil
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
func (h *Handler) clean(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, "POST", "DELETE") || !authorize(w, r, h.Registry.Config.Get("TRIGGER_SECRET")) {
		return
	}
	action := r.URL.Query().Get("action")
	if action != "repair" && action != "delete" {
		failure(w, 400, "invalid_action", "Use repair or delete.")
		return
	}
	if (action == "delete" && r.Method != "DELETE") || (action == "repair" && r.Method != "POST") {
		failure(w, 400, "method_action_mismatch", "Use POST for repair and DELETE for delete.")
		return
	}
	targets := []string{}
	for _, s := range h.Registry.Config.Services() {
		if s.Type == "supabase" || s.Type == "adb" {
			targets = append(targets, s.ID)
		}
	}
	missing := []string{}
	for _, id := range targets {
		missing = append(missing, h.Registry.Missing(id)...)
	}
	if len(missing) > 0 {
		respond(w, 503, map[string]any{"success": false, "error": "configuration_error", "missing": missing})
		return
	}
	results := map[string]any{}
	success := true
	for _, id := range targets {
		cleaner, ok := h.Registry.Backends[id].(db.Cleaner)
		if !ok {
			success = false
			results[id] = map[string]any{"ok": false, "error": "upstream_error"}
			continue
		}
		result, e := cleaner.Clean(r.Context(), action)
		h.Registry.Cache.Invalidate(id)
		if e != nil {
			success = false
			result = map[string]any{"action": action, "ok": false, "error": db.ErrorCode(e)}
		}
		results[id] = result
	}
	status := 200
	if !success {
		status = 502
	}
	respond(w, status, map[string]any{"success": success, "results": results})
}
