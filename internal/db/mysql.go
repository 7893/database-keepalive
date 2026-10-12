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

	if cfg.Tunnel != nil && cfg.Tunnel.Hostname != "" {
		localPort := cfg.Tunnel.LocalPort
		if localPort == 0 {
			localPort = 3307
		}
		connectHost = "127.0.0.1"
		connectPort = localPort

		if err := d.ensureTunnel(); err != nil {
			return nil, err
		}
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

func (m *MySQLDriver) ensureTunnel() error {
	if m.cfg.Tunnel == nil || m.cfg.Tunnel.Hostname == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	localPort := m.cfg.Tunnel.LocalPort
	if localPort == 0 {
		localPort = 3307
	}
	addr := net.JoinHostPort("127.0.0.1", fmt.Sprintf("%d", localPort))

	// If already listening and reachable, reuse the existing tunnel
	conn, err := net.DialTimeout("tcp", addr, 150*time.Millisecond)
	if err == nil {
		conn.Close()
		return nil
	}

	// Clean up any stale or terminated command
	if m.tunnelCmd != nil && m.tunnelCmd.Process != nil {
		_ = m.tunnelCmd.Process.Kill()
		_ = m.tunnelCmd.Wait()
		m.tunnelCmd = nil
	}

	cmd := exec.Command("cloudflared", "access", "tcp",
		"--hostname", m.cfg.Tunnel.Hostname,
		"--url", addr,
	)
	cmd.Env = append(os.Environ(),
		"TUNNEL_SERVICE_TOKEN_ID="+m.cfg.Tunnel.ServiceTokenID,
		"TUNNEL_SERVICE_TOKEN_SECRET="+m.cfg.Tunnel.ServiceTokenSecret,
	)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start cloudflared tunnel for %s: %w", m.cfg.ID, err)
	}
	m.tunnelCmd = cmd

	// Wait up to 3 seconds for the local listener to become responsive
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
	}
	return fmt.Errorf("cloudflared tunnel started but not listening on %s within 3s", addr)
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
		_ = m.tunnelCmd.Wait()
		m.tunnelCmd = nil
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

	if err := m.ensureTunnel(); err != nil {
		return Record{ID: reqID, PingTime: start, Status: "FAILED", DurationMs: time.Since(start).Milliseconds()}, err
	}

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
	if err := m.ensureTunnel(); err != nil {
		return nil, err
	}

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
		idStr := ""
		switch v := id.(type) {
		case []byte:
			idStr = string(v)
		default:
			idStr = fmt.Sprintf("%v", v)
		}
		records = append(records, Record{
			ID:       idStr,
			PingTime: pingTime,
			Status:   status,
		})
	}
	return records, rows.Err()
}
