package web

import "net/http"

// Only display metadata is public, never connection or credential settings.
func (h *Handler) services(w http.ResponseWriter, r *http.Request) {
	if !method(w, r, "GET") {
		return
	}
	type item struct {
		ID     string `json:"id"`
		Type   string `json:"type"`
		Name   string `json:"name"`
		Region string `json:"region"`
	}
	items := []item{}
	for _, s := range h.Registry.Config.Display() {
		items = append(items, item{s.ID, s.Type, s.Title, s.Region})
	}
	respond(w, 200, map[string]any{"services": items, "page_size": h.Registry.Config.Catalog().Display.PageSize})
}
