package db

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	_ "github.com/go-sql-driver/mysql"
)

type MySQLDriver struct {
	cfg       config.InstanceConfig
	db        *sql.DB
	tunnelCmd *exec.Cmd
	mu        sync.Mutex
}

func NewMySQL(cfg config.InstanceConfig) (*MySQLDriver, error) {
	d := &MySQLDriver{cfg: cfg}

	connectHost := cfg.Host
	connectPort := cfg.Port
	if connectPort == 0 {
		connectPort = 3306
	}

	// If Cloudflare Access TCP tunnel is configured, launch the local proxy process on demand
	if cfg.Tunnel != nil && cfg.Tunnel.Hostname != "" {
		localPort := cfg.Tunnel.LocalPort
		if localPort == 0 {
			localPort = 3307
		}
		connectHost = "127.0.0.1"
		connectPort = localPort

		cmd := exec.Command("cloudflared", "access", "tcp",
			"--hostname", cfg.Tunnel.Hostname,
			"--url", net.JoinHostPort("127.0.0.1", fmt.Sprintf("%d", localPort)),
		)
		cmd.Env = append(os.Environ(),
			"TUNNEL_SERVICE_TOKEN_ID="+cfg.Tunnel.ServiceTokenID,
			"TUNNEL_SERVICE_TOKEN_SECRET="+cfg.Tunnel.ServiceTokenSecret,
		)
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard

		if err := cmd.Start(); err != nil {
			return nil, fmt.Errorf("start cloudflared tunnel for %s: %w", cfg.ID, err)
		}
		d.tunnelCmd = cmd
		// Brief delay for the tunnel to establish local listener
		time.Sleep(300 * time.Millisecond)
	}

	dsn := cfg.DSN
	if dsn == "" {
		dbName := cfg.Database
		if dbName == "" {
			dbName = "keepalive"
		}
		dsn = fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?timeout=10s&readTimeout=15s&writeTimeout=15s&parseTime=true&loc=UTC",
			cfg.User, cfg.Password, connectHost, connectPort, dbName)
	}

	dbPool, err := sql.Open("mysql", dsn)
	if err != nil {
		d.Close()
		return nil, fmt.Errorf("open mysql pool for %s: %w", cfg.ID, err)
	}
	dbPool.SetMaxOpenConns(2)
	dbPool.SetMaxIdleConns(1)
	dbPool.SetConnMaxLifetime(5 * time.Minute)

	d.db = dbPool
	return d, nil
}

func (m *MySQLDriver) ID() string     { return m.cfg.ID }
func (m *MySQLDriver) Type() string   { return "mysql" }
func (m *MySQLDriver) Name() string   { return m.cfg.Name }
func (m *MySQLDriver) Region() string { return m.cfg.Region }

func (m *MySQLDriver) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var err error
	if m.db != nil {
		err = m.db.Close()
	}
	if m.tunnelCmd != nil && m.tunnelCmd.Process != nil {
		_ = m.tunnelCmd.Process.Kill()
	}
	return err
}

func (m *MySQLDriver) ensureTable(ctx context.Context) error {
	createSQL := `CREATE TABLE IF NOT EXISTS keepalive_logs (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
		request_id CHAR(36) NOT NULL UNIQUE,
		ping_time DATETIME(6) NOT NULL,
		status VARCHAR(16) NOT NULL,
		KEY idx_ping_time (ping_time DESC, id DESC)
	) ENGINE=InnoDB;`
	_, err := m.db.ExecContext(ctx, createSQL)
	return err
}

func (m *MySQLDriver) Ping(ctx context.Context) (Record, error) {
	start := time.Now()
	reqID := newUUID()

	// Ensure table exists on first ping
	_ = m.ensureTable(ctx)

	insertSQL := `INSERT INTO keepalive_logs (request_id, ping_time, status) VALUES (?, UTC_TIMESTAMP(6), 'SUCCESS')`
	_, err := m.db.ExecContext(ctx, insertSQL, reqID)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		return Record{ID: reqID, PingTime: start, Status: "FAILED", DurationMs: duration}, err
	}

	return Record{
		ID:         reqID,
		PingTime:   start,
		Status:     "SUCCESS",
		DurationMs: duration,
	}, nil
}

func (m *MySQLDriver) QueryLatest(ctx context.Context, limit int) ([]Record, error) {
	if limit <= 0 {
		limit = 10
	}
	querySQL := `SELECT id, ping_time, status FROM keepalive_logs ORDER BY ping_time DESC, id DESC LIMIT ?`
	rows, err := m.db.QueryContext(ctx, querySQL, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []Record
	for rows.Next() {
		var id any
		var pingTime time.Time
		var status string
		if err := rows.Scan(&id, &pingTime, &status); err != nil {
			return nil, err
		}
		records = append(records, Record{
			ID:       fmt.Sprintf("%v", id),
			PingTime: pingTime,
			Status:   status,
		})
	}
	return records, rows.Err()
}
