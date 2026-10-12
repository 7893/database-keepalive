package config_test

import (
	"os"
	"testing"

	"github.com/7893/database-keepalive/internal/config"
)

func TestConfigLoad(t *testing.T) {
	yamlContent := `
server:
  listen: ":9090"
  title: "Test Keepalive"

schedule:
  count: 2
  timezone: "UTC"

instances:
  - id: test_sp
    type: supabase
    name: "Supabase Test"
    url: "https://test.supabase.co"
    key: "test_key"
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())
	_, _ = tmpFile.WriteString(yamlContent)
	_ = tmpFile.Close()

	cfg, err := config.Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("unexpected load error: %v", err)
	}

	if cfg.Server.Listen != ":9090" {
		t.Errorf("expected listen :9090, got %s", cfg.Server.Listen)
	}
	if cfg.Schedule.Count != 2 || cfg.Schedule.Min != 2 || cfg.Schedule.Max != 2 {
		t.Errorf("expected count 2, got %d (min=%d, max=%d)", cfg.Schedule.Count, cfg.Schedule.Min, cfg.Schedule.Max)
	}
	if len(cfg.Instances) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(cfg.Instances))
	}
	if cfg.Instances[0].ID != "test_sp" {
		t.Errorf("expected ID test_sp, got %s", cfg.Instances[0].ID)
	}
}
