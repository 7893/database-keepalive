package scheduler

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/random"
)

const ISO = "2006-01-02T15:04:05.000Z"

type Entry struct {
	Service   string `json:"service"`
	Execution string `json:"execution"`
	PlannedAt string `json:"plannedAt"`
}

type Planner struct {
	Services []config.Service
	Policy   config.Schedule
}

func (p Planner) Daily(day string) ([]Entry, error) {
	midnight, e := time.Parse("2006-01-02", day)
	if e != nil || midnight.Format("2006-01-02") != day {
		return nil, errors.New("invalid_schedule_date")
	}
	loc, e := time.LoadLocation(p.Policy.Timezone)
	if e != nil {
		return nil, errors.New("invalid_schedule_timezone")
	}
	midnight = time.Date(midnight.Year(), midnight.Month(), midnight.Day(), 0, 0, 0, 0, loc)
	if midnight.Format("2006-01-02") != day {
		return nil, errors.New("invalid_schedule_date")
	}
	duration := int(midnight.AddDate(0, 0, 1).Sub(midnight) / time.Minute)
	rounds := p.Policy.DailyMax
	if rounds < 1 || rounds > 24 || p.Policy.DailyMin < 1 || p.Policy.DailyMin > rounds || len(p.Services) > duration/rounds {
		return nil, errors.New("invalid_schedule_capacity")
	}
	services := p.Services
	chosen := map[string]map[int]bool{}
	for _, service := range services {
		integer := random.Seeded("count:v1:" + day + ":" + service.ID)
		count := integer(p.Policy.DailyMin, rounds)
		windows := make([]int, rounds)
		for i := range windows {
			windows[i] = i
		}
		for i := rounds - 1; i > 0; i-- {
			j := integer(0, i)
			windows[i], windows[j] = windows[j], windows[i]
		}
		chosen[service.ID] = map[int]bool{}
		for _, w := range windows[:count] {
			chosen[service.ID][w] = true
		}
	}
	entries := []Entry{}
	for round := 0; round < rounds; round++ {
		execution := fmt.Sprintf("daily:v1:%s:%d", day, round)
		integer := random.Seeded("time:" + execution)
		start := round * duration / rounds
		end := (round + 1) * duration / rounds
		minutes := make([]int, end-start)
		for i := range minutes {
			minutes[i] = i
		}
		for i := len(minutes) - 1; i > 0; i-- {
			j := integer(0, i)
			minutes[i], minutes[j] = minutes[j], minutes[i]
		}
		for i, s := range services {
			if chosen[s.ID][round] {
				stamp := midnight.Add(time.Duration(start+minutes[i]) * time.Minute).UTC()
				entries = append(entries, Entry{s.ID, execution, stamp.Format(ISO)})
			}
		}
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].PlannedAt < entries[j].PlannedAt })
	return entries, nil
}
func (p Planner) Due(stamp string) ([]Entry, error) {
	t, e := time.Parse(time.RFC3339Nano, stamp)
	if e != nil {
		return nil, errors.New("invalid_schedule_time")
	}
	loc, e := time.LoadLocation(p.Policy.Timezone)
	if e != nil {
		return nil, errors.New("invalid_schedule_timezone")
	}
	entries, e := p.Daily(t.In(loc).Format("2006-01-02"))
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
