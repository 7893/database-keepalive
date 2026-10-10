package db

import (
	"context"
	"database/sql"
	"errors"
	"github.com/7893/database-keepalive/internal/geo"
)

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
