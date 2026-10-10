package db

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/7893/database-keepalive/internal/geo"
	"github.com/DATA-DOG/go-sqlmock"
)

var sqlGeo = geo.Geo{Colo: "NRT", Country: "JP", City: "Tokyo", Region: "Tokyo", IP: "1.2.3.4"}

func receiptRows(g geo.Geo) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "ping_time", "status", "colo", "country", "city", "region", "ip", "request_id"}).AddRow(7, time.Now(), "SUCCESS", g.Colo, g.Country, g.City, g.Region, g.IP, "request")
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
				first := receiptRows(sqlGeo)
				if scenario != "existing" {
					first = sqlmock.NewRows([]string{"id", "ping_time", "status", "colo", "country", "city", "region", "ip", "request_id"})
				}
				m.ExpectQuery("SELECT .*request_id.*WHERE .*REQUEST_ID=\\?|SELECT .*request_id.*WHERE request_id=\\?").WithArgs("request").WillReturnRows(first)
				if scenario == "existing" {
					m.ExpectRollback()
				} else {
					if kind == "db2" {
						m.ExpectQuery("SELECT ID FROM FINAL TABLE").WithArgs(sqlGeo.Colo, sqlGeo.Country, sqlGeo.City, sqlGeo.Region, sqlGeo.IP).WillReturnRows(sqlmock.NewRows([]string{"ID"}).AddRow(7))
					}
					insertion := m.ExpectExec("INSERT INTO .*keepalive|INSERT INTO DB2_KEEPALIVE_REQUESTS")
					if kind == "db2" {
						insertion.WithArgs("request", int64(7))
					} else {
						insertion.WithArgs("request", sqlGeo.Colo, sqlGeo.Country, sqlGeo.City, sqlGeo.Region, sqlGeo.IP)
					}
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
					g := sqlGeo
					if scenario == "conflict" {
						g.City = "different"
					}
					m.ExpectQuery("SELECT .*request_id.*WHERE").WithArgs("request").WillReturnRows(receiptRows(g))
				}
				err := store.Ping(context.Background(), "request", sqlGeo)
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
			q.WillReturnRows(sqlmock.NewRows([]string{"id", "ping_time", "status", "colo", "country", "city", "region", "ip"}).AddRow(7, time.Now(), "SUCCESS", nil, nil, nil, nil, nil))
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
