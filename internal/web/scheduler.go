package web

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/7893/database-keepalive/internal/random"
	"github.com/7893/database-keepalive/internal/scheduler"
)

func wait(ctx context.Context, attempt int) error {
	timer := time.NewTimer(time.Duration(attempt) * time.Second)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (h *Handler) runScheduled(ctx context.Context, execution string, targets []string) (map[string]bool, bool) {
	results := map[string]bool{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, target := range targets {
		wg.Go(func() {
			id := random.RequestID(execution, target)
			ok := false
			for attempt := 0; attempt < h.Registry.Config.Catalog().Schedule.Attempts && !ok; attempt++ {
				if attempt > 0 && h.Delay(ctx, attempt) != nil {
					break
				}
				ok = h.Registry.Ping(ctx, target, id) == nil
			}
			log.Printf(`{"event":"scheduled_checkin","service":%q,"ok":%t}`, target, ok)
			mu.Lock()
			results[target] = ok
			mu.Unlock()
		})
	}
	wg.Wait()
	all := true
	for _, ok := range results {
		all = all && ok
	}
	return results, all
}
func (h *Handler) scheduled(w http.ResponseWriter, r *http.Request) {
	if !equal(first(r.Header.Get("X-Database-Keepalive-Scheduler"), r.Header.Get("X-Keepalive-Scheduler")), h.Registry.Config.Get("SCHEDULER_TOKEN")) {
		failure(w, 401, "unauthorized", "Unauthorized")
		return
	}
	if !method(w, r, "POST") {
		return
	}
	stamp := r.Header.Get("X-CloudScheduler-ScheduleTime")
	targets := []string{}
	execution := ""
	if r.URL.Path == "/internal/tick" {
		model := h.Registry.Config.Catalog()
		entries, e := (scheduler.Planner{Services: model.Instances, Policy: model.Schedule}).Due(stamp)
		if e != nil {
			failure(w, 400, "invalid_schedule_time", "A valid scheduler timestamp is required.")
			return
		}
		if len(entries) == 1 {
			if _, enabled := h.Registry.Config.Find(entries[0].Service); !enabled {
				entries = nil
			}
		}
		if len(entries) == 0 {
			respond(w, 200, map[string]any{"success": true, "results": map[string]bool{}})
			return
		}
		execution = entries[0].Execution
		targets = append(targets, entries[0].Service)
	} else {
		name := r.Header.Get("X-CloudScheduler-JobName")
		execution = random.UUID()
		if stamp != "" && name != "" {
			execution = name + ":" + stamp
			if len(execution) > 256 {
				execution = execution[:256]
			}
		}
		for _, s := range h.Registry.Config.Services() {
			targets = append(targets, s.ID)
		}
	}
	results, ok := h.runScheduled(r.Context(), execution, targets)
	status := 200
	if !ok {
		status = 502
	}
	respond(w, status, map[string]any{"success": ok, "results": results})
}
