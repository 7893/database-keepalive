package scheduler

import (
	"crypto/sha256"
	"encoding/binary"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
)

type Status struct {
	LastPing  *db.Record
	NextTime  *time.Time
	PlanTimes []time.Time
}

type Planner struct {
	cfg      config.ScheduleConfig
	statusMu sync.RWMutex
	statuses map[string]*Status
}

func NewPlanner(cfg config.ScheduleConfig) *Planner {
	return &Planner{
		cfg:      cfg,
		statuses: make(map[string]*Status),
	}
}

// GenerateTimes generates all planned check-in timestamps for a specific instance on a given day.
func (p *Planner) GenerateTimes(day time.Time, instanceID string) []time.Time {
	loc := p.cfg.Location()
	dayInLoc := day.In(loc)
	midnight := time.Date(dayInLoc.Year(), dayInLoc.Month(), dayInLoc.Day(), 0, 0, 0, 0, loc)
	dayStr := midnight.Format("2006-01-02")

	// Use Date + InstanceID as deterministic hash seed to preserve daily schedule across service restarts
	h := sha256.Sum256([]byte(dayStr + ":" + instanceID))
	seed := int64(binary.BigEndian.Uint64(h[:8]))
	rng := rand.New(rand.NewSource(seed))

	// Determine total check-in count N for today
	count := p.cfg.Count
	if count <= 0 {
		min := p.cfg.Min
		max := p.cfg.Max
		if min <= 0 {
			min = 1
		}
		if max < min {
			max = min
		}
		if max == min {
			count = min
		} else {
			count = min + rng.Intn(max-min+1)
		}
	}
	if count <= 0 {
		count = 1
	}

	// Partition the 86,400 seconds of the day into N windows, picking a random second in each window
	totalSeconds := 86400
	window := totalSeconds / count
	times := make([]time.Time, 0, count)

	for i := 0; i < count; i++ {
		secOffset := i*window + rng.Intn(window)
		t := midnight.Add(time.Duration(secOffset) * time.Second)
		times = append(times, t)
	}

	sort.Slice(times, func(i, j int) bool {
		return times[i].Before(times[j])
	})

	return times
}

func (p *Planner) GetStatus(instanceID string) *Status {
	p.statusMu.RLock()
	defer p.statusMu.RUnlock()
	return p.statuses[instanceID]
}

func (p *Planner) RecordPing(instanceID string, rec db.Record) {
	p.statusMu.Lock()
	defer p.statusMu.Unlock()
	st, exists := p.statuses[instanceID]
	if !exists {
		st = &Status{}
		p.statuses[instanceID] = st
	}
	st.LastPing = &rec
}

// StartScheduler starts the background autonomous scheduler ticker loop
func (p *Planner) StartScheduler(drivers []db.Driver, onTrigger func(d db.Driver)) {
	loc := p.cfg.Location()
	lastCheck := time.Now().In(loc)

	// Initialize plans and next scheduled times for today
	p.refreshPlans(drivers, lastCheck)

	ticker := time.NewTicker(10 * time.Second)
	go func() {
		for now := range ticker.C {
			current := now.In(loc)

			// Regenerate full-day plans on day boundary crossing
			if current.Day() != lastCheck.Day() {
				p.refreshPlans(drivers, current)
			}

			// Check for any scheduled points in the [lastCheck, current] interval
			for _, d := range drivers {
				st := p.GetStatus(d.ID())
				if st == nil {
					continue
				}
				for _, planned := range st.PlanTimes {
					if (planned.After(lastCheck) || planned.Equal(lastCheck)) &&
						(planned.Before(current) || planned.Equal(current)) {
						go onTrigger(d)
						break
					}
				}
			}

			p.updateNextTimes(drivers, current)
			lastCheck = current
		}
	}()
}

func (p *Planner) refreshPlans(drivers []db.Driver, now time.Time) {
	p.statusMu.Lock()
	defer p.statusMu.Unlock()

	for _, d := range drivers {
		times := p.GenerateTimes(now, d.ID())
		st, exists := p.statuses[d.ID()]
		if !exists {
			st = &Status{}
			p.statuses[d.ID()] = st
		}
		st.PlanTimes = times
	}
}

func (p *Planner) updateNextTimes(drivers []db.Driver, now time.Time) {
	p.statusMu.Lock()
	defer p.statusMu.Unlock()

	for _, d := range drivers {
		st := p.statuses[d.ID()]
		if st == nil {
			continue
		}
		var next *time.Time
		for _, pt := range st.PlanTimes {
			if pt.After(now) {
				tCopy := pt
				next = &tCopy
				break
			}
		}
		// If all scheduled points for today have passed, preview the first point of tomorrow
		if next == nil {
			tomorrowTimes := p.GenerateTimes(now.Add(24*time.Hour), d.ID())
			if len(tomorrowTimes) > 0 {
				next = &tomorrowTimes[0]
			}
		}
		st.NextTime = next
	}
}
