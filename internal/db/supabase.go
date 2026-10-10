package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type Supabase struct{ httpStore }

func NewSupabase(base, key string) *Supabase {
	return &Supabase{httpStore{client: HTTPClient(), url: strings.TrimRight(base, "/") + "/rest/v1/my_keepalive_logs", key: key}}
}
func (s *Supabase) Ping(ctx context.Context, id string) error {
	// Only send writable fields; IDs and timestamps remain database generated.
	payload := map[string]any{"request_id": id, "status": "SUCCESS"}
	_, _, _, e := s.request(ctx, "POST", s.url+"?on_conflict=request_id", payload, map[string]string{"Prefer": "resolution=ignore-duplicates,return=minimal"})
	if e != nil {
		return e
	}
	b, _, _, e := s.request(ctx, "GET", s.url+"?request_id=eq."+url.QueryEscape(id)+"&select=request_id,status", nil, nil)
	if e != nil {
		return e
	}
	var rows []Row
	if e = json.Unmarshal(b, &rows); e != nil {
		return e
	}
	return Confirm(rows, id)
}
func (s *Supabase) Query(ctx context.Context, page int) (Result, error) {
	limit := s.pageSize()
	target := fmt.Sprintf("%s?select=id,ping_time,status&order=ping_time.desc&limit=%d&offset=%d", s.url, limit, (page-1)*limit)
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
	return Successful(rows, count, page, limit), nil
}
