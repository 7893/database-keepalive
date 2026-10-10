package config

import (
	"errors"
	"regexp"
	"time"
	_ "time/tzdata"
)

type Schedule struct {
	DailyMin int    `json:"daily_min"`
	DailyMax int    `json:"daily_max"`
	Timezone string `json:"timezone"`
	Attempts int    `json:"attempts"`
}
type Display struct {
	PageSize       int      `json:"page_size"`
	Fonts          []string `json:"fonts"`
	MonoFonts      []string `json:"mono_fonts"`
	RefreshSeconds int      `json:"refresh_seconds"`
	ShowFullIP     bool     `json:"show_full_ip"`
}
type Runtime struct {
	CacheSeconds int `json:"cache_seconds"`
	Concurrency  int `json:"concurrency"`
}
type Deployment struct {
	Project    string `json:"project"`
	Region     string `json:"region"`
	Service    string `json:"service"`
	Repository string `json:"repository,omitempty"`
}

func (m *Model) validateSettings() error {
	s := m.Schedule
	if s.DailyMin < 1 || s.DailyMax < s.DailyMin || s.DailyMax > 24 || s.Attempts < 1 || s.Attempts > 10 {
		return errors.New("invalid schedule counts or attempts")
	}
	if _, e := time.LoadLocation(s.Timezone); e != nil {
		return errors.New("invalid schedule timezone")
	}
	if len(m.Instances) > 1380/s.DailyMax {
		return errors.New("too many instances for distinct scheduled minutes")
	}
	d := &m.Display
	if d.PageSize < 1 || d.PageSize > 100 || d.RefreshSeconds < 0 || (d.RefreshSeconds > 0 && d.RefreshSeconds < 30) || d.RefreshSeconds > 86400 {
		return errors.New("invalid display page_size or refresh_seconds")
	}
	if len(d.Fonts) == 0 {
		d.Fonts = []string{"Ubuntu", "system-ui", "sans-serif"}
	}
	if len(d.MonoFonts) == 0 {
		d.MonoFonts = []string{"Ubuntu Mono", "monospace"}
	}
	font := regexp.MustCompile(`^[\pL\pN -]{1,64}$`)
	for _, fonts := range [][]string{d.Fonts, d.MonoFonts} {
		if len(fonts) > 10 {
			return errors.New("configure at most 10 fonts per stack")
		}
		for _, f := range fonts {
			if !font.MatchString(f) {
				return errors.New("invalid font family")
			}
		}
	}
	if m.Runtime.CacheSeconds < 0 || m.Runtime.CacheSeconds > 3600 || m.Runtime.Concurrency < 1 || m.Runtime.Concurrency > 64 {
		return errors.New("invalid runtime cache_seconds or concurrency")
	}
	slug := regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)
	if m.Deployment.Repository == "" {
		m.Deployment.Repository = m.Deployment.Service
	}
	for _, v := range []string{m.Deployment.Project, m.Deployment.Region, m.Deployment.Service, m.Deployment.Repository} {
		if v != "" && !slug.MatchString(v) {
			return errors.New("invalid deployment project, region or service")
		}
	}
	return nil
}
