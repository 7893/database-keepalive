//go:build db2 && cgo

package db

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/7893/database-keepalive/internal/config"
	ibm "github.com/ibmdb/go_ibm_db"
)

func NewDb2(c config.Config) (*SQLStore, error) {
	// Reject connection-string delimiters rather than allowing credential injection.
	for _, key := range []string{"DB2_HOST", "DB2_PORT", "DB2_DATABASE", "DB2_USER", "DB2_PASSWORD", "DB2_CA_FILE"} {
		if strings.ContainsAny(c.Get(key), ";{}\x00\r\n") {
			return nil, fmt.Errorf("invalid Db2 configuration: %s", key)
		}
	}
	if _, e := os.Stat(c.Get("DB2_CA_FILE")); e != nil {
		return nil, errors.New("db2_ca_unavailable")
	}
	dsn := fmt.Sprintf("DATABASE=%s;HOSTNAME=%s;PORT=%s;PROTOCOL=TCPIP;UID=%s;PWD=%s;Security=SSL;SSLServerCertificate=%s;SSLClientHostnameValidation=Basic;ConnectTimeout=5;ReceiveTimeout=8;QueryTimeout=8;", c.Get("DB2_DATABASE"), c.Get("DB2_HOST"), c.Get("DB2_PORT"), c.Get("DB2_USER"), c.Get("DB2_PASSWORD"), c.Get("DB2_CA_FILE"))
	pool, e := sql.Open("go_ibm_db", dsn)
	if e != nil {
		return nil, errors.New("db2_driver_unavailable")
	}
	configurePool(pool)
	return &SQLStore{Pool: pool, Kind: "db2", Duplicate: func(e error) bool {
		var de *ibm.Error
		if !errors.As(e, &de) {
			return false
		}
		for _, r := range de.Diag {
			if r.State == "23505" {
				return true
			}
		}
		return false
	}}, nil
}
