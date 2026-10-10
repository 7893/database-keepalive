package db

import (
	"context"
	"database/sql"
	"time"

	"github.com/7893/database-keepalive/internal/geo"
)

const fields = "id,ping_time,status,colo,country,city,region,ip"

type SQLStore struct {
	size      int
	Pool      *sql.DB
	Kind      string
	Duplicate func(error) bool
}

func (s *SQLStore) SetPageSize(size int) { s.size = size }
func (s *SQLStore) pageSize() int {
	if s.size > 0 {
		return s.size
	}
	return PageSize
}

type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (s *SQLStore) Close() error { return s.Pool.Close() }
func scanRows(rows *sql.Rows, requestID bool) ([]Row, error) {
	defer rows.Close()
	result := []Row{}
	for rows.Next() {
		var r Row
		var stamp time.Time
		var values [5]sql.NullString
		args := []any{&r.ID, &stamp, &r.Status, &values[0], &values[1], &values[2], &values[3], &values[4]}
		if requestID {
			args = append(args, &r.RequestID)
		}
		if e := rows.Scan(args...); e != nil {
			return nil, e
		}
		r.PingTime = stamp.UTC().Format("2006-01-02T15:04:05.000000Z")
		r.Geo = geo.Geo{Colo: values[0].String, Country: values[1].String, City: values[2].String, Region: values[3].String, IP: values[4].String}
		result = append(result, r)
	}
	return result, rows.Err()
}
func (s *SQLStore) lookup(ctx context.Context, q querier, id string) ([]Row, error) {
	statement := "SELECT " + fields + ",request_id FROM keepalive_logs WHERE request_id=?"
	if s.Kind == "db2" {
		statement = "SELECT l.id,l.ping_time,l.status,l.colo,l.country,l.city,l.region,l.ip,r.request_id FROM DB2_KEEPALIVE_LOGS l JOIN DB2_KEEPALIVE_REQUESTS r ON l.ID=r.LOG_ID WHERE r.REQUEST_ID=?"
	}
	rows, e := q.QueryContext(ctx, statement, id)
	if e != nil {
		return nil, e
	}
	return scanRows(rows, true)
}
func (s *SQLStore) begin(ctx context.Context, readOnly bool) (*sql.Tx, error) {
	options := &sql.TxOptions{}
	if s.Kind == "mysql" {
		options.ReadOnly = readOnly
		options.Isolation = sql.LevelRepeatableRead
	}
	tx, e := s.Pool.BeginTx(ctx, options)
	if e != nil {
		return nil, e
	}
	if s.Kind == "db2" && readOnly {
		if _, e = tx.ExecContext(ctx, "SET CURRENT ISOLATION RR"); e != nil {
			tx.Rollback()
			return nil, e
		}
	}
	return tx, nil
}
func configurePool(pool *sql.DB) {
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(0)
	pool.SetConnMaxLifetime(time.Minute)
}
