package config

import (
	"fmt"
	"os"
	"time"

	"go.yaml.in/yaml/v3"
)

type Config struct {
	Server    ServerConfig     `yaml:"server"`
	Schedule  ScheduleConfig   `yaml:"schedule"`
	Instances []InstanceConfig `yaml:"instances"`
}

type ServerConfig struct {
	Listen string `yaml:"listen"` // Default ":8080"
	Title  string `yaml:"title"`  // Default "Database Keepalive"
}

type ScheduleConfig struct {
	Count    int    `yaml:"count"`    // Fixed daily check-in count (e.g., 2)
	Min      int    `yaml:"min"`      // Minimum count in random range (default 1)
	Max      int    `yaml:"max"`      // Maximum count in random range (default 3)
	Timezone string `yaml:"timezone"` // Default "Local" (host system timezone)
}

type TunnelConfig struct {
	Hostname           string `yaml:"hostname"`
	ServiceTokenID     string `yaml:"service_token_id"`
	ServiceTokenSecret string `yaml:"service_token_secret"`
	LocalPort          int    `yaml:"local_port"` // Default 3307 or dynamically assigned
}

type InstanceConfig struct {
	ID       string        `yaml:"id"`
	Type     string        `yaml:"type"` // "supabase", "oracle", "mysql"
	Name     string        `yaml:"name"`
	Region   string        `yaml:"region"`
	URL      string        `yaml:"url"`      // Supabase REST or Oracle ORDS API
	Key      string        `yaml:"key"`      // Supabase API Key / Secret Key
	User     string        `yaml:"user"`     // Oracle / MySQL username
	Password string        `yaml:"password"` // Oracle / MySQL password
	Host     string        `yaml:"host"`     // MySQL host
	Port     int           `yaml:"port"`     // MySQL port (default 3306)
	Database string        `yaml:"database"` // MySQL database name
	DSN      string        `yaml:"dsn"`      // Optional raw DSN for MySQL
	Tunnel   *TunnelConfig `yaml:"tunnel"`   // Optional Cloudflare Access TCP tunnel
}

func (s *ScheduleConfig) Location() *time.Location {
	if s.Timezone == "" || s.Timezone == "Local" {
		return time.Local
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		return time.Local
	}
	return loc
}

func Load(path string) (*Config, error) {
	if path == "" {
		if envPath := os.Getenv("DATABASE_KEEPALIVE_CONFIG"); envPath != "" {
			path = envPath
		} else if _, err := os.Stat("config.yaml"); err == nil {
			path = "config.yaml"
		} else if _, err := os.Stat("config.yml"); err == nil {
			path = "config.yml"
		} else if _, err := os.Stat("/etc/database-keepalive/config.yaml"); err == nil {
			path = "/etc/database-keepalive/config.yaml"
		} else {
			path = "config.yaml"
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	// Automatically expand environment variables like ${VAR_NAME}
	expanded := os.ExpandEnv(string(data))

	var cfg Config
	if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("parse config yaml: %w", err)
	}

	// Apply smart defaults
	if cfg.Server.Listen == "" {
		cfg.Server.Listen = ":8080"
	}
	if cfg.Server.Title == "" {
		cfg.Server.Title = "Database Keepalive"
	}

	// Schedule defaults
	if cfg.Schedule.Count <= 0 {
		if cfg.Schedule.Min <= 0 && cfg.Schedule.Max <= 0 {
			cfg.Schedule.Min = 1
			cfg.Schedule.Max = 3
		} else if cfg.Schedule.Min <= 0 {
			cfg.Schedule.Min = 1
		} else if cfg.Schedule.Max < cfg.Schedule.Min {
			cfg.Schedule.Max = cfg.Schedule.Min
		}
	} else {
		cfg.Schedule.Min = cfg.Schedule.Count
		cfg.Schedule.Max = cfg.Schedule.Count
	}

	if cfg.Schedule.Timezone == "" {
		cfg.Schedule.Timezone = "Local"
	}

	// Instance defaults
	for i := range cfg.Instances {
		inst := &cfg.Instances[i]
		if inst.ID == "" {
			inst.ID = fmt.Sprintf("db_%d", i+1)
		}
		if inst.Name == "" {
			inst.Name = inst.ID
		}
		if inst.Port == 0 && inst.Type == "mysql" {
			inst.Port = 3306
		}
		if inst.Tunnel != nil && inst.Tunnel.LocalPort == 0 {
			inst.Tunnel.LocalPort = 3307 + i
		}
	}

	return &cfg, nil
}
