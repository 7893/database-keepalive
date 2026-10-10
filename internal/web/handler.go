package web

import (
	"context"
	"net/http"
	"net/url"
	"sync"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/ui"
)

type Handler struct {
	Registry *db.Registry
	Delay    func(context.Context, int) error
	active   chan struct{}
}

func New(registry *db.Registry) *Handler {
	return &Handler{Registry: registry, Delay: wait, active: make(chan struct{}, registry.Config.Catalog().Runtime.Concurrency)}
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case h.active <- struct{}{}:
		defer func() { <-h.active }()
	default:
		w.Header().Set("Retry-After", "5")
		failure(w, 503, "busy", "Try again later.")
		return
	}
	switch r.URL.Path {
	case "/internal/tick", "/internal/checkin":
		h.scheduled(w, r)
	case "/api/data":
		h.data(w, r)
	case "/api/services":
		h.services(w, r)
	case "/":
		h.page(w, r)
	case "/debug":
		if method(w, r, "GET") && authorize(w, r, h.Registry.Config.Get("TRIGGER_SECRET")) {
			respond(w, 200, h.stats(r, false))
		}
	case "/trigger":
		h.trigger(w, r)
	default:
		failure(w, 404, "not_found", "Route not found.")
	}
}
func (h *Handler) data(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, "GET") {
		return
	}
	id := r.URL.Query().Get("service")
	if _, ok := h.Registry.Config.Find(id); !ok {
		failure(w, 400, "invalid_service", "Unknown database service.")
		return
	}
	result := h.Registry.Query(r.Context(), id, config.Page(r.URL.Query().Get("page")))
	status := 200
	if !result.OK {
		status = 502
		if result.Error == "configuration_error" {
			status = 503
		}
	}
	respond(w, status, result)
}
func first(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
func (h *Handler) stats(r *http.Request, public bool) map[string]db.Result {
	stats := map[string]db.Result{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	q := r.URL.Query()
	for _, service := range h.Registry.Config.Services() {
		wg.Go(func() {
			primary := service.ID
			if public {
				primary += "_p"
			}
			page := config.Page(first(q.Get(primary), q.Get(service.Alias), q.Get("page")))
			result := h.Registry.Query(r.Context(), service.ID, page)
			mu.Lock()
			stats[service.ID] = result
			mu.Unlock()
		})
	}
	wg.Wait()
	return stats
}
func (h *Handler) page(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, "GET", "HEAD") {
		return
	}
	body, e := ui.Render(h.stats(r, true), h.Registry.Config)
	if e != nil {
		failure(w, 500, "internal_error", "Unable to render page.")
		return
	}
	secure(w, true)
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		w.Write(body)
	}
}
func origin(fallback string) string {
	u, e := url.Parse(fallback)
	if e != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
