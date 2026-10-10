package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const yamlFixture = `# Configure one database in any region.
database_types:
  adb: true
instances:
  - id: lunar
    type: adb
    region: Moon
    env_prefix: LUNAR
`

func TestYAMLCommentsDefaultsAndOverrides(t *testing.T) {
	m := parseFixture(t, yamlFixture+`
display:
  page_size: 7 # Per-card pagination.
  fonts: [Ubuntu, sans-serif]
schedule:
  attempts: 2
deployment:
  service: test-service
`)
	if m.Instances[0].Title != "Oracle Cloud ADB · Moon" || m.Display.PageSize != 7 || m.Schedule.Attempts != 2 {
		t.Fatal("YAML settings or comments lost")
	}
	if m.Schedule.DailyMin != 1 || m.Schedule.DailyMax != 3 || m.Schedule.Timezone != "Asia/Singapore" || m.Runtime.CacheSeconds != 60 || m.Deployment.Repository != "test-service" {
		t.Fatal("omitted defaults changed")
	}
}

func TestYAMLRejectsAmbiguousSettingsPrivately(t *testing.T) {
	for name, suffix := range map[string]string{
		"unknown":        "unknown: true\n",
		"nested typo":    "display:\n  page_szie: 10\n",
		"duplicate":      "display:\n  page_size: 7\n  page_size: 9\n",
		"duplicate type": "database_types:\n  adb: true\n",
		"multi document": "---\n" + yamlFixture,
		"fractional":     "display:\n  page_size: 2.5\n",
		"private value":  "display:\n  page_size: test-private-value\n",
	} {
		t.Run(name, func(t *testing.T) {
			_, e := Parse([]byte(yamlFixture + suffix))
			if e == nil || strings.Contains(e.Error(), "test-private-value") {
				t.Fatal("invalid YAML accepted or private value exposed")
			}
		})
	}
}

func TestLoadMountedYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.yaml")
	if e := os.WriteFile(path, []byte(yamlFixture), 0600); e != nil {
		t.Fatal(e)
	}
	for key, value := range map[string]string{
		"DATABASE_KEEPALIVE_CONFIG": path, "PORT": "8080", "PUBLIC_ORIGIN": "https://test.example",
		"TRIGGER_SECRET": "test-admin", "SCHEDULER_TOKEN": "test-scheduler",
		"LUNAR_URL": "https://test.example", "LUNAR_USER": "test-user", "LUNAR_PASS": "test-secret",
	} {
		t.Setenv(key, value)
	}
	c, e := Load()
	if e != nil || len(c.Services()) != 1 || c.Services()[0].ID != "lunar" {
		t.Fatal("mounted YAML not used", e)
	}
}
