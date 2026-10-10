package db

import (
	"context"
	"errors"
	"fmt"
)

func (s *SQLStore) Query(ctx context.Context, page int) (Result, error) {
	limit := s.pageSize()
	tx, e := s.begin(ctx, true)
	if e != nil {
		return Result{}, e
	}
	defer tx.Rollback()
	table := "keepalive_logs"
	if s.Kind == "db2" {
		table = "DB2_KEEPALIVE_LOGS"
	}
	var count int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); e != nil {
		return Result{}, e
	}
	if count < 0 {
		return Result{}, errors.New("invalid_count")
	}
	statement := fmt.Sprintf("SELECT %s FROM %s ORDER BY ping_time DESC,id DESC LIMIT ? OFFSET ?", fields, table)
	args := []any{limit, (page - 1) * limit}
	if s.Kind == "db2" {
		statement = fmt.Sprintf("SELECT %s FROM %s ORDER BY ping_time DESC,id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY", fields, table)
		args = []any{(page - 1) * limit, limit}
	}
	rows, e := tx.QueryContext(ctx, statement, args...)
	if e != nil {
		return Result{}, e
	}
	result, e := scanRows(rows, false)
	if e != nil {
		return Result{}, e
	}
	return Successful(result, count, page, limit), nil
}
