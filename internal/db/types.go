package db

import (
	"context"
	"errors"
	"net"
	"strconv"
	"strings"

	"github.com/7893/keepalive/internal/geo"
)

const PageSize = 10

var ErrConflict = errors.New("request_id_reused")

type Row struct {
	ID       int64  `json:"id"`
	PingTime string `json:"ping_time"`
	Status   string `json:"status"`
	geo.Geo
	RequestID string `json:"request_id,omitempty"`
}
type Result struct {
	OK         bool     `json:"ok"`
	Rows       []Row    `json:"rows"`
	Count      int64    `json:"count"`
	Page       int      `json:"page"`
	Limit      int      `json:"limit"`
	TotalPages int64    `json:"totalPages"`
	Error      string   `json:"error,omitempty"`
	Missing    []string `json:"missing,omitempty"`
}
type Backend interface {
	Ping(context.Context, string, geo.Geo) error
	Query(context.Context, int) (Result, error)
}
type Cleaner interface {
	Clean(context.Context, string) (map[string]any, error)
}

func Successful(rows []Row, count int64, page int) Result {
	if rows == nil {
		rows = []Row{}
	}
	total := (count + PageSize - 1) / PageSize
	if total < 1 {
		total = 1
	}
	return Result{OK: true, Rows: rows, Count: count, Page: page, Limit: PageSize, TotalPages: total}
}
func Failure(page int, err error) Result {
	return Result{Rows: []Row{}, Page: page, Limit: PageSize, TotalPages: 1, Error: ErrorCode(err)}
}
func ErrorCode(err error) string {
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()) {
		return "upstream_timeout"
	}
	return "upstream_error"
}
func Confirm(rows []Row, id string, g geo.Geo) error {
	if len(rows) != 1 || rows[0].RequestID != id || rows[0].Status != "SUCCESS" {
		return errors.New("commit_unconfirmed")
	}
	if rows[0].Geo != g {
		return ErrConflict
	}
	return nil
}
func MaskIP(value string, full bool) string {
	if value == "" {
		return "—"
	}
	if full {
		return value
	}
	parts := strings.Split(value, ".")
	if len(parts) == 4 {
		valid := true
		for _, p := range parts {
			n, e := strconv.Atoi(p)
			if e != nil || n < 0 || n > 255 {
				valid = false
			}
		}
		if valid {
			return strings.Join(parts[:3], ".") + ".xxx"
		}
	}
	if net.ParseIP(value) != nil && strings.Contains(value, ":") {
		p := []string{}
		for _, s := range strings.Split(value, ":") {
			if s != "" {
				p = append(p, s)
			}
			if len(p) == 3 {
				break
			}
		}
		if len(p) > 0 {
			return strings.Join(p, ":") + "::"
		}
		return "IPv6"
	}
	return "—"
}
func Public(r Result, full bool) Result {
	r.Rows = append([]Row{}, r.Rows...)
	for i := range r.Rows {
		r.Rows[i].IP = MaskIP(r.Rows[i].IP, full)
	}
	return r
}
