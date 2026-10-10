package scheduler

import (
	"github.com/7893/database-keepalive/internal/config"
	"reflect"
	"testing"
	"time"
)

func TestConfigPolicyAndDSTDays(t *testing.T) {
	services := []config.Service{{ID: "moon"}, {ID: "europe"}, {ID: "pacific"}}
	for _, day := range []string{"2026-03-08", "2026-11-01"} {
		p := Planner{services, config.Schedule{DailyMin: 2, DailyMax: 5, Timezone: "America/New_York", Attempts: 2}}
		plan, e := p.Daily(day)
		if e != nil {
			t.Fatal(e)
		}
		loc, _ := time.LoadLocation(p.Policy.Timezone)
		start, _ := time.ParseInLocation("2006-01-02", day, loc)
		duration := int(start.AddDate(0, 0, 1).Sub(start) / time.Minute)
		want := 1380
		if day == "2026-11-01" {
			want = 1500
		}
		if duration != want {
			t.Fatal("wrong DST fixture")
		}
		counts := map[string]int{}
		minutes := map[string]bool{}
		for _, entry := range plan {
			if minutes[entry.PlannedAt] {
				t.Fatal("shared minute")
			}
			minutes[entry.PlannedAt] = true
			counts[entry.Service]++
			at, e := time.Parse(ISO, entry.PlannedAt)
			if e != nil || at.In(loc).Format("2006-01-02") != day {
				t.Fatal("wrong configured calendar day")
			}
			due, e := p.Due(at.Add(32 * time.Second).Format(time.RFC3339Nano))
			if e != nil || len(due) != 1 || due[0] != entry {
				t.Fatal("due identity lost")
			}
		}
		for _, s := range services {
			if counts[s.ID] < 2 || counts[s.ID] > 5 {
				t.Fatal("configured counts ignored")
			}
		}
		again, _ := p.Daily(day)
		if !reflect.DeepEqual(plan, again) {
			t.Fatal("non repeatable plan")
		}
	}
}
func TestDisabledTypesPreservePlannedMinutes(t *testing.T) {
	m := config.DefaultModel()
	p := Planner{m.Instances, m.Schedule}
	before, _ := p.Daily("2026-10-11")
	m.Types["adb"] = false
	after, _ := p.Daily("2026-10-11")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("disabling a type reshuffled configured slots")
	}
	// Server filtering changes enabled tasks, not the planner's seed roster.
	if len((config.Config{Model: m}).Services()) != 3 {
		t.Fatal("type selection not respected")
	}
}
func TestFixedCountAndInvalidCapacity(t *testing.T) {
	p := Planner{[]config.Service{{ID: "one"}, {ID: "two"}}, config.Schedule{DailyMin: 4, DailyMax: 4, Timezone: "UTC", Attempts: 1}}
	plan, e := p.Daily("2026-10-11")
	if e != nil || len(plan) != 8 {
		t.Fatal("fixed count ignored")
	}
	p.Policy.DailyMin = 0
	if _, e := p.Daily("2026-10-11"); e == nil {
		t.Fatal("invalid count accepted")
	}
	p.Policy.DailyMin = 1
	p.Policy.DailyMax = 24
	p.Services = make([]config.Service, 61)
	if _, e := p.Daily("2026-10-11"); e == nil {
		t.Fatal("minute collision allowed")
	}
}
