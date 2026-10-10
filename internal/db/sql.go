package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/7893/keepalive/internal/geo"
)

const fields = "id,ping_time,status,colo,country,city,region,ip"

type SQLStore struct {
	Pool      *sql.DB
	Kind      string
	Duplicate func(error) bool
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
func (s *SQLStore) insert(ctx context.Context, tx *sql.Tx, id string, g geo.Geo) error {
	values := []any{g.Colo, g.Country, g.City, g.Region, g.IP}
	if s.Kind == "db2" {
		var rowID int64
		e := tx.QueryRowContext(ctx, "SELECT ID FROM FINAL TABLE (INSERT INTO DB2_KEEPALIVE_LOGS (PING_TIME,STATUS,COLO,COUNTRY,CITY,REGION,IP) VALUES (CURRENT TIMESTAMP - CURRENT TIMEZONE,'SUCCESS',?,?,?,?,?))", values...).Scan(&rowID)
		if e != nil {
			return e
		}
		result, e := tx.ExecContext(ctx, "INSERT INTO DB2_KEEPALIVE_REQUESTS (REQUEST_ID,LOG_ID) VALUES (?,?)", id, rowID)
		return affected(result, e)
	}
	result, e := tx.ExecContext(ctx, "INSERT INTO keepalive_logs (request_id,ping_time,status,colo,country,city,region,ip) VALUES (?,UTC_TIMESTAMP(6),'SUCCESS',?,?,?,?,?)", append([]any{id}, values...)...)
	return affected(result, e)
}
func affected(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return errors.New("insert_unconfirmed")
	}
	return nil
}
func (s *SQLStore) Ping(ctx context.Context, id string, g geo.Geo) error {
	tx, e := s.begin(ctx, false)
	if e != nil {
		return e
	}
	rows, e := s.lookup(ctx, tx, id)
	if e == nil && len(rows) == 0 {
		e = s.insert(ctx, tx, id, g)
		if e == nil {
			e = tx.Commit()
		}
	}
	tx.Rollback()
	if e != nil && (s.Duplicate == nil || !s.Duplicate(e)) {
		return e
	}
	// Idle connections are disabled, so this receipt is read on an independent session.
	receipt, e := s.lookup(ctx, s.Pool, id)
	if e != nil {
		return e
	}
	return Confirm(receipt, id, g)
}
func (s *SQLStore) Query(ctx context.Context, page int) (Result, error) {
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
	args := []any{PageSize, (page - 1) * PageSize}
	if s.Kind == "db2" {
		statement = fmt.Sprintf("SELECT %s FROM %s ORDER BY ping_time DESC,id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY", fields, table)
		args = []any{(page - 1) * PageSize, PageSize}
	}
	rows, e := tx.QueryContext(ctx, statement, args...)
	if e != nil {
		return Result{}, e
	}
	result, e := scanRows(rows, false)
	if e != nil {
		return Result{}, e
	}
	return Successful(result, count, page), nil
}
func configurePool(pool *sql.DB) {
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(0)
	pool.SetConnMaxLifetime(time.Minute)
}
