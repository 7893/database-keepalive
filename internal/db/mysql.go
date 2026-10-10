package db

import (
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"net"
	"os"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	mysql "github.com/go-sql-driver/mysql"
)

func mysqlTLS(c config.Config) (*tls.Config, error) {
	data, e := os.ReadFile(c.Get("MYSQL_SSL_CA"))
	if e != nil {
		return nil, errors.New("mysql_ca_unavailable")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(data) {
		return nil, errors.New("invalid_mysql_ca")
	}
	verify := c.Get("MYSQL_SSL_VERIFY_IDENTITY") != "false"
	result := &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots, ServerName: c.Get("MYSQL_HOST")}
	if !verify {
		// OCI private-IP endpoints need CA-only verification; never skip the chain check.
		result.InsecureSkipVerify = true
		result.VerifyConnection = func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("missing_mysql_certificate")
			}
			inter := x509.NewCertPool()
			for _, cert := range state.PeerCertificates[1:] {
				inter.AddCert(cert)
			}
			_, e := state.PeerCertificates[0].Verify(x509.VerifyOptions{Roots: roots, Intermediates: inter, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}})
			return e
		}
	}
	return result, nil
}
func NewMySQL(c config.Config) (*SQLStore, error) {
	transport, e := mysqlTLS(c)
	if e != nil {
		return nil, e
	}
	options := mysql.NewConfig()
	options.User = c.Get("MYSQL_USER")
	options.Passwd = c.Get("MYSQL_PASSWORD")
	options.DBName = c.Get("MYSQL_DATABASE")
	options.Net = "tcp"
	options.Addr = net.JoinHostPort(c.Get("MYSQL_HOST"), c.Get("MYSQL_PORT"))
	options.TLS = transport
	options.ParseTime = true
	options.Loc = time.UTC
	options.Timeout = 5 * time.Second
	options.ReadTimeout = 8 * time.Second
	options.WriteTimeout = 8 * time.Second
	options.Collation = "utf8mb4_unicode_ci"
	options.Params = map[string]string{"innodb_lock_wait_timeout": "5"}
	connector, e := mysql.NewConnector(options)
	if e != nil {
		return nil, errors.New("invalid_mysql_configuration")
	}
	pool := sql.OpenDB(connector)
	configurePool(pool)
	return &SQLStore{Pool: pool, Kind: "mysql", Duplicate: func(e error) bool { var me *mysql.MySQLError; return errors.As(e, &me) && me.Number == 1062 }}, nil
}
