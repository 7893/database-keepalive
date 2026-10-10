package db

import (
	"context"
	"database/sql"
	"errors"
)

func (s *SQLStore) insert(ctx context.Context, tx *sql.Tx, id string) error {
	statement := "INSERT INTO keepalive_logs (request_id,ping_time,status) VALUES (?,UTC_TIMESTAMP(6),'SUCCESS')"
	if s.Kind == "db2" {
		statement = "INSERT INTO DB2_KEEPALIVE_LOGS (REQUEST_ID,PING_TIME,STATUS) VALUES (?,CURRENT TIMESTAMP - CURRENT TIMEZONE,'SUCCESS')"
	}
	result, e := tx.ExecContext(ctx, statement, id)
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
func (s *SQLStore) Ping(ctx context.Context, id string) error {
	tx, e := s.begin(ctx, false)
	if e != nil {
		return e
	}
	rows, e := s.lookup(ctx, tx, id)
	if e == nil && len(rows) == 0 {
		e = s.insert(ctx, tx, id)
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
	return Confirm(receipt, id)
}
