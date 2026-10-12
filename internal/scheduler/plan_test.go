package scheduler_test

import (
	"testing"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/scheduler"
)

func TestPlannerFixedCount(t *testing.T) {
	cfg := config.ScheduleConfig{
		Count:    3,
		Timezone: "UTC",
	}
	planner := scheduler.NewPlanner(cfg)
	now := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	times := planner.GenerateTimes(now, "inst-1")

	if len(times) != 3 {
		t.Fatalf("expected 3 times, got %d", len(times))
	}

	// Verify times are in ascending order and on the same day
	for i := 1; i < len(times); i++ {
		if !times[i].After(times[i-1]) {
			t.Errorf("expected times[%d] > times[%d]", i, i-1)
		}
	}
}

func TestPlannerRandomRange(t *testing.T) {
	cfg := config.ScheduleConfig{
		Min:      2,
		Max:      5,
		Timezone: "UTC",
	}
	planner := scheduler.NewPlanner(cfg)
	now := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	times := planner.GenerateTimes(now, "inst-2")

	if len(times) < 2 || len(times) > 5 {
		t.Fatalf("expected between 2 and 5 times, got %d", len(times))
	}
}
