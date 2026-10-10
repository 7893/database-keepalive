package config

import (
	"go.yaml.in/yaml/v3"
	"strings"
	"testing"
)

func parseFixture(t *testing.T, data string) *Model {
	t.Helper()
	m, e := Parse([]byte(data))
	if e != nil {
		t.Fatal(e)
	}
	return m
}

const moon = `{"database_types":{"adb":true},"instances":[{"id":"moon","type":"adb","region":"Moon Sea of Tranquility","env_prefix":"MOON"}]}`

func TestArbitraryRegionAndOnlySelectedCredentials(t *testing.T) {
	m := parseFixture(t, moon)
	c := Config{Model: m, Env: map[string]string{
		"PORT": "8080", "PUBLIC_ORIGIN": "https://test.example", "TRIGGER_SECRET": "test-admin", "SCHEDULER_TOKEN": "test-scheduler",
		"MOON_URL": "https://moon.example", "MOON_USER": "test-user", "MOON_PASS": "test-secret",
	}}
	if e := c.Validate(); e != nil {
		t.Fatal(e)
	}
	if len(c.Services()) != 1 || c.Services()[0].Title != "Oracle Cloud ADB · Moon Sea of Tranquility" {
		t.Fatal("region restricted or disabled service added")
	}
	if c.Connection(c.Services()[0]).Get("ADB_USER") != "test-user" {
		t.Fatal("custom credential prefix lost")
	}
	delete(c.Env, "MOON_PASS")
	if e := c.Validate(); e == nil || !strings.Contains(e.Error(), "MOON_PASS") || strings.Contains(e.Error(), "test-secret") {
		t.Fatal("required credentials not enforced privately")
	}
}
func TestFiveDisplayNames(t *testing.T) {
	want := []string{"Supabase Database", "IBM Cloud Db2", "Oracle Cloud ADB · United States", "Oracle Cloud MySQL · Japan", "Oracle Cloud ADB · Japan"}
	services := (Config{}).Display()
	if len(services) != len(want) {
		t.Fatal("wrong instance count")
	}
	for i, s := range services {
		if s.Title != want[i] {
			t.Fatalf("%d: %s", i, s.Title)
		}
	}
}
func TestInvalidModelsAndSettings(t *testing.T) {
	for _, data := range []string{
		`{}`, `{"database_types":{"adb":false}}`,
		strings.Replace(moon, `"adb":true`, `"postgres":true`, 1),
		strings.Replace(moon, `"adb":true`, `"adb":true,"mysql":true`, 1),
		strings.Replace(moon, `"env_prefix":"MOON"`, `"env_prefix":"MOON","tunnel_prefix":"MOON"`, 1),
		strings.TrimSuffix(moon, "}") + `,"unknown":1}`,
	} {
		if _, e := Parse([]byte(data)); e == nil {
			t.Fatal("invalid model accepted")
		}
	}
	invalid := []string{
		`"schedule":{"daily_min":0}`, `"schedule":{"daily_max":0}`,
		`"schedule":{"daily_min":4,"daily_max":3}`, `"schedule":{"attempts":0}`,
		`"schedule":{"timezone":"Mars/Olympus"}`, `"display":{"page_size":0}`,
		`"display":{"page_size":101}`, `"display":{"refresh_seconds":1}`,
		`"display":{"fonts":["bad';color:red"]}`, `"runtime":{"concurrency":0}`,
		`"runtime":{"cache_seconds":-1}`, `"deployment":{"service":"bad\nSERVICE=hacked"}`,
	}
	for _, setting := range invalid {
		data := strings.TrimSuffix(moon, "}") + "," + setting + "}"
		if _, e := Parse([]byte(data)); e == nil {
			t.Fatalf("invalid setting accepted: %s", setting)
		}
	}
}
func TestPrefixIsolationAndDisabledTypes(t *testing.T) {
	m := parseFixture(t, `{"database_types":{"adb":true,"mysql":false},"instances":[
        {"id":"one","type":"adb","env_prefix":"FIRST","name":"First database"},
        {"id":"two","type":"adb","env_prefix":"SECOND","region":"Europe"},
        {"id":"disabled","type":"mysql","env_prefix":"UNUSED"}]}`)
	c := Config{Model: m, Env: map[string]string{"FIRST_PASS": "test-first", "SECOND_PASS": "test-second"}}
	if len(c.Services()) != 2 {
		t.Fatal("disabled type active")
	}
	for i, want := range []string{"test-first", "test-second"} {
		if c.Connection(c.Services()[i]).Get("ADB_PASS") != want {
			t.Fatal("credentials crossed instances")
		}
	}
	if _, ok := c.Find("disabled"); ok {
		t.Fatal("disabled instance found")
	}
	data, _ := yaml.Marshal(m)
	m, e := Parse(data)
	if e != nil || m.Instances[0].Title != "First database" {
		t.Fatal("model round trip lost custom name")
	}
}
