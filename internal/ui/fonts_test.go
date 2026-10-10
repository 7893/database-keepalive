package ui

import (
	"github.com/7893/database-keepalive/internal/config"
	"strings"
	"testing"
)

func TestFontPreferenceAndSystemFallback(t *testing.T) {
	m, e := config.Parse([]byte(`{"database_types":{"supabase":true},"instances":[{"id":"one","type":"supabase","env_prefix":"ONE"}],"display":{"fonts":["Roboto","Ubuntu"],"mono_fonts":["Fira Code","Ubuntu Mono"]}}`))
	if e != nil {
		t.Fatal(e)
	}
	body, e := Render(nil, config.Config{Model: m})
	if e != nil {
		t.Fatal(e)
	}
	for _, want := range []string{`--font-body:'Roboto','Ubuntu',system-ui,sans-serif`, `--font-mono:'Fira Code','Ubuntu Mono',monospace`, `"fonts":["Roboto","Ubuntu"]`, `https://fonts.googleapis.com/css2?family=`, `&display=swap`} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("missing %s", want)
		}
	}
	if strings.Contains(string(body), "@font-face") || strings.Contains(string(body), ".woff") {
		t.Fatal("offline font asset used")
	}
}
