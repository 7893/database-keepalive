package db

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func receiptRows(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "ping_time", "status", "request_id"}).AddRow(7, time.Now(), status, "request")
}
func TestSQLReceiptAndRollback(t *testing.T) {
	duplicate := errors.New("duplicate")
	for _, kind := range []string{"mysql", "db2"} {
		for _, scenario := range []string{"insert", "existing", "duplicate", "conflict", "commit_failure"} {
			t.Run(kind+"/"+scenario, func(t *testing.T) {
				pool, m, e := sqlmock.New()
				if e != nil {
					t.Fatal(e)
				}
				defer pool.Close()
				store := SQLStore{Pool: pool, Kind: kind, Duplicate: func(e error) bool { return errors.Is(e, duplicate) }}
				m.ExpectBegin()
				first := receiptRows("SUCCESS")
				if scenario != "existing" {
					first = sqlmock.NewRows([]string{"id", "ping_time", "status", "request_id"})
				}
				m.ExpectQuery("SELECT .*request_id.*WHERE .*REQUEST_ID=\\?|SELECT .*request_id.*WHERE request_id=\\?").WithArgs("request").WillReturnRows(first)
				if scenario == "existing" {
					m.ExpectRollback()
				} else {
					insertion := m.ExpectExec("INSERT INTO keepalive_logs|INSERT INTO DB2_KEEPALIVE_LOGS").WithArgs("request")
					if scenario == "duplicate" {
						insertion.WillReturnError(duplicate)
						m.ExpectRollback()
					} else {
						insertion.WillReturnResult(sqlmock.NewResult(7, 1))
						commit := m.ExpectCommit()
						if scenario == "commit_failure" {
							commit.WillReturnError(errors.New("uncertain_commit"))
						}
					}
				}
				if scenario != "commit_failure" {
					status := "SUCCESS"
					if scenario == "conflict" {
						status = "FAILED"
					}
					m.ExpectQuery("SELECT .*request_id.*WHERE").WithArgs("request").WillReturnRows(receiptRows(status))
				}
				err := store.Ping(context.Background(), "request")
				wantFailure := scenario == "conflict" || scenario == "commit_failure"
				if (err != nil) != wantFailure {
					t.Fatalf("error=%v", err)
				}
				if e := m.ExpectationsWereMet(); e != nil {
					t.Fatal(e)
				}
			})
		}
	}
}
func TestSQLPageUsesOneSnapshot(t *testing.T) {
	for _, kind := range []string{"mysql", "db2"} {
		t.Run(kind, func(t *testing.T) {
			pool, m, e := sqlmock.New()
			if e != nil {
				t.Fatal(e)
			}
			defer pool.Close()
			m.ExpectBegin()
			if kind == "db2" {
				m.ExpectExec("SET CURRENT ISOLATION RR").WillReturnResult(sqlmock.NewResult(0, 0))
			}
			m.ExpectQuery("SELECT COUNT").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(12))
			q := m.ExpectQuery("SELECT .*ORDER BY ping_time DESC,id DESC")
			if kind == "db2" {
				q.WithArgs(10, 10)
			} else {
				q.WithArgs(10, 10)
			}
			q.WillReturnRows(sqlmock.NewRows([]string{"id", "ping_time", "status"}).AddRow(7, time.Now(), "SUCCESS"))
			m.ExpectRollback()
			result, e := (&SQLStore{Pool: pool, Kind: kind}).Query(context.Background(), 2)
			if e != nil || !result.OK || result.Count != 12 || len(result.Rows) != 1 || result.TotalPages != 2 {
				t.Fatalf("result=%+v error=%v", result, e)
			}
			if e := m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}
