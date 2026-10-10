package config

import (
	"errors"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Service struct {
	ID, Title, Alias string
	Required         []string
}

// Keep execution order stable: it is part of schedule and geographic seeds.
var Services = []Service{
	{"supabase", "Supabase", "sb_p", []string{"SUPABASE_URL", "SUPABASE_SECRET_KEY"}},
	{"adb_us", "Oracle ADB · United States", "us_p", []string{"OCI_ADB_US_URL", "OCI_ADB_US_USER", "OCI_ADB_US_PASS"}},
	{"adb_jp", "Oracle ADB · Japan", "jp_p", []string{"OCI_ADB_JP_URL", "OCI_ADB_JP_USER", "OCI_ADB_JP_PASS"}},
	{"db2", "IBM Db2", "db2_p", []string{"DB2_HOST", "DB2_PORT", "DB2_DATABASE", "DB2_USER", "DB2_PASSWORD", "DB2_CA_FILE"}},
	{"mysql_jp", "MySQL · Japan", "mysql_jp_p", []string{"MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_SSL_CA"}},
}
var Display = []int{0, 3, 1, 4, 2}

type Config map[string]string

func (c Config) Get(key string) string { return c[key] }
func (c Config) Missing(names []string) []string {
	var missing []string
	for _, name := range names {
		if c[name] == "" {
			missing = append(missing, name)
		}
	}
	return missing
}
func Find(id string) (Service, bool) {
	for _, s := range Services {
		if s.ID == id {
			return s, true
		}
	}
	return Service{}, false
}
func Load() (Config, error) {
	c := Config{}
	for _, entry := range os.Environ() {
		k, v, _ := strings.Cut(entry, "=")
		c[k] = v
	}
	if c["PORT"] == "" {
		c["PORT"] = "8080"
	}
	required := []string{"TRIGGER_SECRET", "SCHEDULER_TOKEN", "PUBLIC_ORIGIN", "MYSQL_CA_PEM", "TUNNEL_SERVICE_HOSTNAME", "TUNNEL_SERVICE_TOKEN_ID", "TUNNEL_SERVICE_TOKEN_SECRET"}
	for _, s := range Services {
		required = append(required, s.Required...)
	}
	if missing := c.Missing(required); len(missing) > 0 {
		return nil, errors.New("missing configuration: " + strings.Join(missing, ", "))
	}
	for _, key := range []string{"PORT", "MYSQL_PORT", "DB2_PORT"} {
		n, e := strconv.Atoi(c[key])
		if e != nil || n < 1 || n > 65535 {
			return nil, errors.New("invalid configuration: " + key)
		}
	}
	for _, key := range []string{"MYSQL_SSL_VERIFY_IDENTITY", "MYSQL_SSL_STRICT"} {
		if c[key] != "" && c[key] != "true" && c[key] != "false" {
			return nil, errors.New("invalid configuration: " + key)
		}
	}
	if ip := net.ParseIP(c["MYSQL_HOST"]); ip == nil || !ip.IsLoopback() {
		return nil, errors.New("MYSQL_HOST must be a loopback address")
	}
	for _, key := range []string{"PUBLIC_ORIGIN", "SUPABASE_URL", "OCI_ADB_US_URL", "OCI_ADB_JP_URL"} {
		u, e := url.Parse(c[key])
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
			return nil, errors.New("invalid configuration: " + key)
		}
	}
	return c, nil
}

// Preserve parseInt-style pagination inputs while bounding all SQL offsets.
func Page(value string) int {
	value = strings.TrimSpace(value)
	end := 0
	for i, r := range value {
		if (i == 0 && (r == '+' || r == '-')) || (r >= '0' && r <= '9') {
			end = i + 1
		} else {
			break
		}
	}
	n, e := strconv.ParseInt(value[:end], 10, 64)
	if e != nil {
		return 1
	}
	if n < 1 {
		return 1
	}
	if n > 10000 {
		return 10000
	}
	return int(n)
}
