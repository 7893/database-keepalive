package config

import (
	"strings"
	"testing"
)

func TestPaginationBounds(t *testing.T) {
	for value, want := range map[string]int{"": 1, "invalid": 1, "-2": 1, "2junk": 2, "99999": 10000, "10": 10} {
		if got := Page(value); got != want {
			t.Fatalf("%q: %d != %d", value, got, want)
		}
	}
}

func TestStartupValidatesConfigurationWithoutValues(t *testing.T) {
	for _, service := range Services {
		for _, key := range service.Required {
			t.Setenv(key, "test-value")
		}
	}
	for key, value := range map[string]string{
		"PORT": "8080", "MYSQL_PORT": "13306", "DB2_PORT": "50001", "MYSQL_HOST": "127.0.0.1",
		"TRIGGER_SECRET": "test-token", "SCHEDULER_TOKEN": "test-token", "PUBLIC_ORIGIN": "https://database-keepalive.test",
		"MYSQL_CA_PEM": "test-ca", "TUNNEL_SERVICE_HOSTNAME": "tunnel.test", "TUNNEL_SERVICE_TOKEN_ID": "test-id", "TUNNEL_SERVICE_TOKEN_SECRET": "test-secret",
		"SUPABASE_URL": "https://supabase.test", "OCI_ADB_US_URL": "https://us.test", "OCI_ADB_JP_URL": "https://jp.test",
		"MYSQL_SSL_VERIFY_IDENTITY": "false", "MYSQL_SSL_STRICT": "false",
	} {
		t.Setenv(key, value)
	}
	if _, e := Load(); e != nil {
		t.Fatal(e)
	}
	for _, port := range []string{"0", "-1", "65536", "abc", "13306junk"} {
		t.Run(port, func(t *testing.T) {
			t.Setenv("MYSQL_PORT", port)
			_, e := Load()
			if e == nil || !strings.Contains(e.Error(), "MYSQL_PORT") {
				t.Fatal("invalid port accepted")
			}
		})
	}
	t.Setenv("MYSQL_HOST", "::1")
	if _, e := Load(); e != nil {
		t.Fatal(e)
	}
	t.Setenv("DB2_PASSWORD", "")
	_, e := Load()
	if e == nil || !strings.Contains(e.Error(), "DB2_PASSWORD") || strings.Contains(e.Error(), "test-secret") {
		t.Fatal("unsafe missing config error")
	}
}
