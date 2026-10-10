package scheduler

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/geo"
)

const ISO = "2006-01-02T15:04:05.000Z"

var local = time.FixedZone("UTC+8", 8*3600)

type Entry struct {
	Service   string `json:"service"`
	Execution string `json:"execution"`
	PlannedAt string `json:"plannedAt"`
}

func Daily(day string) ([]Entry, error) {
	midnight, e := time.Parse("2006-01-02", day)
	if e != nil || midnight.Format("2006-01-02") != day {
		return nil, errors.New("invalid_schedule_date")
	}
	chosen := map[string]map[int]bool{}
	for _, service := range config.Services {
		integer := geo.Seeded("count:v1:" + day + ":" + service.ID)
		count := integer(1, 3)
		windows := []int{0, 1, 2}
		for i := 2; i > 0; i-- {
			j := integer(0, i)
			windows[i], windows[j] = windows[j], windows[i]
		}
		chosen[service.ID] = map[int]bool{}
		for _, w := range windows[:count] {
			chosen[service.ID][w] = true
		}
	}
	entries := []Entry{}
	for round := 0; round < 3; round++ {
		execution := fmt.Sprintf("daily:v1:%s:%d", day, round)
		integer := geo.Seeded("time:" + execution)
		minutes := make([]int, 480)
		for i := range minutes {
			minutes[i] = i
		}
		for i := 479; i > 0; i-- {
			j := integer(0, i)
			minutes[i], minutes[j] = minutes[j], minutes[i]
		}
		for i, s := range config.Services {
			if chosen[s.ID][round] {
				stamp := midnight.Add(-8*time.Hour + time.Duration(round*480+minutes[i])*time.Minute)
				entries = append(entries, Entry{s.ID, execution, stamp.Format(ISO)})
			}
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].PlannedAt < entries[j].PlannedAt })
	return entries, nil
}
func Due(stamp string) ([]Entry, error) {
	t, e := time.Parse(time.RFC3339Nano, stamp)
	if e != nil {
		return nil, errors.New("invalid_schedule_time")
	}
	entries, e := Daily(t.In(local).Format("2006-01-02"))
	if e != nil {
		return nil, e
	}
	minute := t.UTC().Truncate(time.Minute).Format(ISO)
	due := []Entry{}
	for _, entry := range entries {
		if entry.PlannedAt == minute {
			due = append(due, entry)
		}
	}
	return due, nil
}
