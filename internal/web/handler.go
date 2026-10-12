package web

import (
	"context"
	_ "embed"
	"encoding/json"
	"html/template"
	"net/http"
	"sync"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/scheduler"
)

//go:embed static/index.html
var indexHTML string

type Server struct {
	cfg     *config.Config
	drivers []db.Driver
	planner *scheduler.Planner
	tmpl    *template.Template
}

func NewServer(cfg *config.Config, drivers []db.Driver, planner *scheduler.Planner) (*Server, error) {
	tmpl, err := template.New("index").Parse(indexHTML)
	if err != nil {
		return nil, err
	}
	return &Server{
		cfg:     cfg,
		drivers: drivers,
		planner: planner,
		tmpl:    tmpl,
	}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /api/status", s.handleStatus)
	mux.HandleFunc("POST /api/trigger", s.handleTrigger)
	return mux
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	data := map[string]any{
		"Title": s.cfg.Server.Title,
	}
	_ = s.tmpl.Execute(w, data)
}

type instanceStatus struct {
	ID             string      `json:"id"`
	Type           string      `json:"type"`
	Name           string      `json:"name"`
	Region         string      `json:"region"`
	LastStatus     string      `json:"last_status"`
	LastDurationMs int64       `json:"last_duration_ms"`
	NextTime       *time.Time  `json:"next_time"`
	History        []db.Record `json:"history"`
	Error          string      `json:"error,omitempty"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	results := make([]instanceStatus, len(s.drivers))
	var wg sync.WaitGroup

	for i, d := range s.drivers {
		wg.Add(1)
		go func(idx int, driver db.Driver) {
			defer wg.Done()
			status := instanceStatus{
				ID:     driver.ID(),
				Type:   driver.Type(),
				Name:   driver.Name(),
				Region: driver.Region(),
			}

			if st := s.planner.GetStatus(driver.ID()); st != nil {
				if st.LastPing != nil {
					status.LastStatus = st.LastPing.Status
					status.LastDurationMs = st.LastPing.DurationMs
				}
				status.NextTime = st.NextTime
			}

			// Concurrently query remote database activity logs to boost activity
			hist, err := driver.QueryLatest(ctx, 4)
			if err != nil {
				status.Error = err.Error()
				if status.LastStatus == "" {
					status.LastStatus = "FAILED"
				}
			} else {
				status.History = hist
				if len(hist) > 0 && status.LastStatus == "" {
					status.LastStatus = hist[0].Status
				}
			}

			results[idx] = status
		}(i, d)
	}

	wg.Wait()

	response := map[string]any{
		"timezone":  s.cfg.Schedule.Timezone,
		"instances": results,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (s *Server) handleTrigger(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	results := make(map[string]any)
	var mu sync.Mutex

	for _, d := range s.drivers {
		wg.Add(1)
		go func(driver db.Driver) {
			defer wg.Done()
			rec, err := driver.Ping(ctx)
			s.planner.RecordPing(driver.ID(), rec)

			mu.Lock()
			if err != nil {
				results[driver.ID()] = map[string]any{"ok": false, "error": err.Error(), "duration_ms": rec.DurationMs}
			} else {
				results[driver.ID()] = map[string]any{"ok": true, "duration_ms": rec.DurationMs}
			}
			mu.Unlock()
		}(d)
	}

	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"results": results,
	})
}
