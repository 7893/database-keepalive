package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"sort"
	"strings"

	settings "github.com/7893/database-keepalive"
)

var defaults = settings.DefaultSettings()

var typeNames = map[string]string{
	"supabase": "Supabase Database", "db2": "IBM Cloud Db2",
	"adb": "Oracle Cloud ADB", "mysql": "Oracle Cloud MySQL",
}

type Service struct {
	ID           string   `json:"id"`
	Type         string   `json:"type"`
	Name         string   `json:"name,omitempty"`
	Region       string   `json:"region,omitempty"`
	Prefix       string   `json:"env_prefix"`
	TunnelPrefix string   `json:"tunnel_prefix,omitempty"`
	Order        int      `json:"display_order,omitempty"`
	Title        string   `json:"-"`
	Alias        string   `json:"-"`
	Required     []string `json:"-"`
}
type Model struct {
	Types      map[string]bool `json:"database_types"`
	Instances  []Service       `json:"instances"`
	Schedule   Schedule        `json:"schedule"`
	Display    Display         `json:"display"`
	Runtime    Runtime         `json:"runtime"`
	Deployment Deployment      `json:"deployment"`
}

func Parse(data []byte) (*Model, error) {
	m := Model{Schedule: Schedule{1, 3, "Asia/Singapore", 3}, Display: Display{PageSize: 10, Fonts: []string{"Ubuntu", "system-ui", "sans-serif"}, MonoFonts: []string{"Ubuntu Mono", "monospace"}}, Runtime: Runtime{60, 16}}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&m) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid DATABASE_KEEPALIVE_CONFIG JSON")
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
func DefaultModel() *Model {
	m, e := Parse(defaults)
	if e != nil {
		panic(e)
	}
	return m
}

// These slots keep legacy schedules stable. User configurations replace them.
var Services = DefaultModel().Instances

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
