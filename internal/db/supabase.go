package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/7893/keepalive/internal/geo"
)

type Supabase struct{ httpStore }

func NewSupabase(base, key string) *Supabase {
	return &Supabase{httpStore{client: HTTPClient(), url: strings.TrimRight(base, "/") + "/rest/v1/my_keepalive_logs", key: key}}
}
func (s *Supabase) Ping(ctx context.Context, id string, g geo.Geo) error {
	body := Row{Status: "SUCCESS", Geo: g, RequestID: id}
	// Only send writable fields; IDs and timestamps remain database generated.
	payload := map[string]any{"request_id": id, "status": body.Status, "colo": g.Colo, "country": g.Country, "city": g.City, "region": g.Region, "ip": g.IP}
	_, _, _, e := s.request(ctx, "POST", s.url+"?on_conflict=request_id", payload, map[string]string{"Prefer": "resolution=ignore-duplicates,return=minimal"})
	if e != nil {
		return e
	}
	b, _, _, e := s.request(ctx, "GET", s.url+"?request_id=eq."+url.QueryEscape(id)+"&select=request_id,status,colo,country,city,region,ip", nil, nil)
	if e != nil {
		return e
	}
	var rows []Row
	if e = json.Unmarshal(b, &rows); e != nil {
		return e
	}
	return Confirm(rows, id, g)
}
func (s *Supabase) Query(ctx context.Context, page int) (Result, error) {
	target := fmt.Sprintf("%s?select=id,ping_time,status,colo,country,city,region,ip&order=ping_time.desc&limit=%d&offset=%d", s.url, PageSize, (page-1)*PageSize)
	b, h, _, e := s.request(ctx, "GET", target, nil, map[string]string{"Prefer": "count=exact"})
	if e != nil {
		return Result{}, e
	}
	var rows []Row
	if e = json.Unmarshal(b, &rows); e != nil {
		return Result{}, e
	}
	_, tail, _ := strings.Cut(h.Get("Content-Range"), "/")
	count, e := strconv.ParseInt(tail, 10, 64)
	if e != nil || count < 0 {
		return Result{}, errors.New("invalid_count")
	}
	return Successful(rows, count, page), nil
}
func (s *Supabase) Clean(ctx context.Context, action string) (map[string]any, error) {
	filters := []string{"city=eq.Edge", "colo=eq.SIN&country=eq.US"}
	method := "DELETE"
	bodies := []any{nil, nil}
	if action == "repair" {
		method = "PATCH"
		filters[0] = "colo=eq.SLC&city=eq.Edge"
		bodies = []any{map[string]string{"city": "Salt Lake City", "region": "Utah"}, map[string]string{"country": "SG"}}
	}
	statuses := []int{}
	var failure error
	for i, filter := range filters {
		_, _, code, e := s.request(ctx, method, s.url+"?"+filter, bodies[i], nil)
		statuses = append(statuses, code)
		if e != nil {
			failure = e
		}
	}
	return map[string]any{"action": action, "ok": failure == nil, "status": statuses}, failure
}
