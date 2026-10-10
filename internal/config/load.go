package config

import (
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func Load() (Config, error) {
	c := Config{Env: map[string]string{}}
	for _, entry := range os.Environ() {
		k, v, _ := strings.Cut(entry, "=")
		c.Env[k] = v
	}
	if c.Get("PORT") == "" {
		c.Env["PORT"] = "8080"
	}
	data := defaults
	if path := c.Get("DATABASE_KEEPALIVE_CONFIG"); path != "" {
		var e error
		data, e = os.ReadFile(path)
		if e != nil || len(data) > 1<<20 {
			return c, errors.New("unable to read DATABASE_KEEPALIVE_CONFIG")
		}
	}
	m, e := Parse(data)
	if e != nil {
		return c, e
	}
	c.Model = m
	if e = c.Validate(); e != nil {
		return c, e
	}
	return c, nil
}
func (c Config) Validate() error {
	required := []string{"TRIGGER_SECRET", "SCHEDULER_TOKEN", "PUBLIC_ORIGIN"}
	for _, s := range c.Services() {
		required = append(required, s.Required...)
	}
	if missing := c.Missing(required); len(missing) > 0 {
		return errors.New("missing configuration: " + strings.Join(missing, ", "))
	}
	if e := port("PORT", c.Get("PORT")); e != nil {
		return e
	}
	if e := https("PUBLIC_ORIGIN", c.Get("PUBLIC_ORIGIN")); e != nil {
		return e
	}
	listeners := map[string]bool{}
	certificates := map[string]string{}
	for _, s := range c.Services() {
		d := c.Connection(s)
		switch s.Type {
		case "supabase", "adb":
			if e := https(s.Prefix+"_URL", c.Get(s.Prefix+"_URL")); e != nil {
				return e
			}
		case "db2", "mysql":
			if e := port(s.Prefix+"_PORT", c.Get(s.Prefix+"_PORT")); e != nil {
				return e
			}
		}
		if s.Type == "mysql" {
			path := filepath.Clean(d.Get("MYSQL_SSL_CA"))
			pem := d.Get("MYSQL_CA_PEM")
			if previous, exists := certificates[path]; exists && previous != pem && (previous != "" || pem != "") {
				return errors.New("conflicting MySQL CA contents at a shared path")
			}
			certificates[path] = pem
			for _, suffix := range []string{"SSL_VERIFY_IDENTITY", "SSL_STRICT"} {
				value := d.Get("MYSQL_" + suffix)
				if value != "" && value != "true" && value != "false" {
					return errors.New("invalid configuration: " + s.Prefix + "_" + suffix)
				}
			}
			if s.TunnelPrefix != "" {
				ip := net.ParseIP(d.Get("MYSQL_HOST"))
				if ip == nil || !ip.IsLoopback() {
					return errors.New(s.Prefix + "_HOST must be loopback when using a tunnel")
				}
				address := net.JoinHostPort(ip.String(), d.Get("MYSQL_PORT"))
				if listeners[address] || d.Get("MYSQL_PORT") == c.Get("PORT") {
					return errors.New("conflicting local tunnel listener")
				}
				listeners[address] = true
				if e := https(s.TunnelPrefix+"_HOSTNAME", "https://"+d.Get("TUNNEL_SERVICE_HOSTNAME")); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
func port(key, value string) error {
	n, e := strconv.Atoi(value)
	if e != nil || n < 1 || n > 65535 {
		return errors.New("invalid configuration: " + key)
	}
	return nil
}
func https(key, value string) error {
	u, e := url.Parse(value)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return errors.New("invalid configuration: " + key)
	}
	return nil
}
