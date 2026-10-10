package db

import (
	"context"
	"errors"
	"net"
)

const PageSize = 10

type Row struct {
	ID        int64  `json:"id"`
	PingTime  string `json:"ping_time"`
	Status    string `json:"status"`
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
	Ping(context.Context, string) error
	Query(context.Context, int) (Result, error)
}

func Successful(rows []Row, count int64, page int, sizes ...int) Result {
	limit := PageSize
	if len(sizes) > 0 {
		limit = sizes[0]
	}
	if rows == nil {
		rows = []Row{}
	}
	total := (count + int64(limit) - 1) / int64(limit)
	if total < 1 {
		total = 1
	}
	return Result{OK: true, Rows: rows, Count: count, Page: page, Limit: limit, TotalPages: total}
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
func Confirm(rows []Row, id string) error {
	if len(rows) != 1 || rows[0].RequestID != id || rows[0].Status != "SUCCESS" {
		return errors.New("commit_unconfirmed")
	}
	return nil
}
