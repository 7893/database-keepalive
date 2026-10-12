package db

import (
	"context"
	"fmt"
	"time"

	"github.com/7893/database-keepalive/internal/config"
)

type Record struct {
	ID         string    `json:"id"`
	PingTime   time.Time `json:"ping_time"`
	Status     string    `json:"status"`
	DurationMs int64     `json:"duration_ms"`
}

type Driver interface {
	ID() string
	Type() string
	Name() string
	Region() string
	Ping(ctx context.Context) (Record, error)
	QueryLatest(ctx context.Context, limit int) ([]Record, error)
	Close() error
}

func NewDriver(inst config.InstanceConfig) (Driver, error) {
	switch inst.Type {
	case "supabase":
		return NewSupabase(inst)
	case "oracle", "oracle_adb", "adb":
		return NewOracle(inst)
	case "mysql":
		return NewMySQL(inst)
	default:
		return nil, fmt.Errorf("unsupported database type: %s", inst.Type)
	}
}
