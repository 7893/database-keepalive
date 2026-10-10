package config

import (
	"bytes"
	"errors"
	"io"
	"regexp"
	"sort"
	"strings"

	settings "github.com/7893/database-keepalive"
	"go.yaml.in/yaml/v3"
)

var defaults = settings.DefaultSettings()

var typeNames = map[string]string{
	"supabase": "Supabase Database", "db2": "IBM Cloud Db2",
	"adb": "Oracle Cloud ADB", "mysql": "Oracle Cloud MySQL",
}

type Service struct {
	ID           string   `yaml:"id"`
	Type         string   `yaml:"type"`
	Name         string   `yaml:"name,omitempty"`
	Region       string   `yaml:"region,omitempty"`
	Prefix       string   `yaml:"env_prefix"`
	TunnelPrefix string   `yaml:"tunnel_prefix,omitempty"`
	Order        int      `yaml:"display_order,omitempty"`
	Title        string   `yaml:"-"`
	Alias        string   `yaml:"-"`
	Required     []string `yaml:"-"`
}
type Model struct {
	Types      map[string]bool `yaml:"database_types"`
	Instances  []Service       `yaml:"instances"`
	Schedule   Schedule        `yaml:"schedule"`
	Display    Display         `yaml:"display"`
	Runtime    Runtime         `yaml:"runtime"`
	Deployment Deployment      `yaml:"deployment"`
}

func Parse(data []byte) (*Model, error) {
	if len(data) > 1<<20 {
		return nil, errors.New("DATABASE_KEEPALIVE_CONFIG exceeds 1 MiB")
	}
	m := Model{Schedule: Schedule{1, 3, "Asia/Singapore", 3}, Display: Display{PageSize: 10, Fonts: []string{"Ubuntu", "system-ui", "sans-serif"}, MonoFonts: []string{"Ubuntu Mono", "monospace"}}, Runtime: Runtime{60, 16}}
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	if decoder.Decode(&m) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid DATABASE_KEEPALIVE_CONFIG YAML")
	}
	// YAML otherwise permits silently truncating floats into integer settings.
	var document yaml.Node
	if yaml.Unmarshal(data, &document) != nil || hasFloat(&document) {
		return nil, errors.New("configuration numbers must be integers")
	}
	enabled := false
	for kind, on := range m.Types {
		if typeNames[kind] == "" {
			return nil, errors.New("unknown database type")
		}
		enabled = enabled || on
	}
	if !enabled {
		return nil, errors.New("select at least one database type")
	}
	if len(m.Instances) == 0 || len(m.Instances) > 480 {
		return nil, errors.New("configure between 1 and 480 instances")
	}
	ids := map[string]bool{}
	prefixes := map[string]bool{}
	counts := map[string]int{}
	idPattern := regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	envPattern := regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
	for i := range m.Instances {
		s := &m.Instances[i]
		if !idPattern.MatchString(s.ID) || ids[s.ID] || typeNames[s.Type] == "" || !envPattern.MatchString(s.Prefix) || prefixes[s.Prefix] {
			return nil, errors.New("invalid or duplicate instance id, type or env_prefix")
		}
		if s.TunnelPrefix != "" && (s.Type != "mysql" || !envPattern.MatchString(s.TunnelPrefix) || prefixes[s.TunnelPrefix] || s.TunnelPrefix == s.Prefix) {
			return nil, errors.New("invalid or duplicate tunnel_prefix")
		}
		ids[s.ID] = true
		prefixes[s.Prefix] = true
		if s.TunnelPrefix != "" {
			prefixes[s.TunnelPrefix] = true
		}
		s.Title = strings.TrimSpace(s.Name)
		if s.Title == "" {
			s.Title = typeNames[s.Type]
			if s.Region != "" {
				s.Title += " · " + s.Region
			}
		}
		if len(s.Title) > 256 || len(s.Region) > 256 {
			return nil, errors.New("instance name or region too long")
		}
		s.Alias = map[string]string{"supabase": "sb_p", "adb_us": "us_p", "adb_jp": "jp_p", "db2": "db2_p", "mysql_jp": "mysql_jp_p"}[s.ID]
		s.Required = required(*s)
		counts[s.Type]++
	}
	for kind, on := range m.Types {
		if on && counts[kind] == 0 {
			return nil, errors.New("enabled database type requires an instance")
		}
	}
	if e := m.validateSettings(); e != nil {
		return nil, e
	}
	return &m, nil
}

func hasFloat(node *yaml.Node) bool {
	if node.Tag == "!!float" {
		return true
	}
	for _, child := range node.Content {
		if hasFloat(child) {
			return true
		}
	}
	return false
}

func DefaultModel() *Model {
	m, e := Parse(defaults)
	if e != nil {
		panic(e)
	}
	return m
}

func (c Config) Catalog() *Model {
	if c.Model != nil {
		return c.Model
	}
	return DefaultModel()
}
func (c Config) Services() []Service {
	m := c.Catalog()
	result := []Service{}
	for _, s := range m.Instances {
		if m.Types[s.Type] {
			result = append(result, s)
		}
	}
	return result
}
func (c Config) Display() []Service {
	result := c.Services()
	sort.SliceStable(result, func(i, j int) bool { return result[i].Order < result[j].Order })
	return result
}
func (c Config) Find(id string) (Service, bool) {
	for _, s := range c.Services() {
		if s.ID == id {
			return s, true
		}
	}
	return Service{}, false
}
