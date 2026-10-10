package runtime

import (
	"github.com/7893/database-keepalive/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestDisabledConnectionsNeverStartOrWrite(t *testing.T) {
	m, e := config.Parse([]byte(`{"database_types":{"supabase":true,"mysql":false},"instances":[
      {"id":"active","type":"supabase","env_prefix":"ACTIVE"},
      {"id":"off","type":"mysql","env_prefix":"OFF","tunnel_prefix":"OFF_TUNNEL"}]}`))
	if e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(t.TempDir(), "unused.pem")
	c := config.Config{Model: m, Env: map[string]string{"OFF_CA_PEM": "test-content", "OFF_SSL_CA": path}}
	if e := prepareCertificates(c); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(path); !os.IsNotExist(e) {
		t.Fatal("disabled instance wrote a file")
	}
	exit, stop, e := startTunnels(c)
	if e != nil {
		t.Fatal(e)
	}
	defer stop()
	if exit != nil {
		t.Fatal("disabled instance started a tunnel")
	}
}
func TestDirectMySQLDoesNotStartTunnel(t *testing.T) {
	m, e := config.Parse([]byte(`{"database_types":{"mysql":true},"instances":[{"id":"direct","type":"mysql","env_prefix":"DIRECT"}]}`))
	if e != nil {
		t.Fatal(e)
	}
	c := config.Config{Model: m, Env: map[string]string{"DIRECT_HOST": "mysql.example"}}
	exit, stop, e := startTunnels(c)
	defer stop()
	if e != nil || exit != nil {
		t.Fatal("direct connection depends on cloudflared")
	}
}
