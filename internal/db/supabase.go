package db

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/7893/database-keepalive/internal/config"
)

type SupabaseDriver struct {
	cfg        config.InstanceConfig
	endpoint   string
	httpClient *http.Client
}

func NewSupabase(cfg config.InstanceConfig) (*SupabaseDriver, error) {
	if cfg.URL == "" || cfg.Key == "" {
		return nil, fmt.Errorf("supabase instance %s requires url and key", cfg.ID)
	}
	base := strings.TrimRight(cfg.URL, "/")
	return &SupabaseDriver{
		cfg:      cfg,
		endpoint: base + "/rest/v1/my_keepalive_logs",
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}, nil
}

func (s *SupabaseDriver) ID() string     { return s.cfg.ID }
func (s *SupabaseDriver) Type() string   { return "supabase" }
func (s *SupabaseDriver) Name() string   { return s.cfg.Name }
func (s *SupabaseDriver) Region() string { return s.cfg.Region }
func (s *SupabaseDriver) Close() error   { return nil }

func (s *SupabaseDriver) Ping(ctx context.Context) (Record, error) {
	start := time.Now()
	reqID := newUUID()
	payload, _ := json.Marshal(map[string]any{
		"request_id": reqID,
		"status":     "SUCCESS",
	})

	url := s.endpoint + "?on_conflict=request_id"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(payload))
	if err != nil {
		return Record{}, err
	}
	req.Header.Set("apikey", s.cfg.Key)
	req.Header.Set("Authorization", "Bearer "+s.cfg.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "resolution=ignore-duplicates,return=minimal")

	resp, err := s.httpClient.Do(req)
	duration := time.Since(start).Milliseconds()
	if err != nil {
		return Record{ID: reqID, PingTime: start, Status: "FAILED", DurationMs: duration}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return Record{ID: reqID, PingTime: start, Status: "FAILED", DurationMs: duration},
			fmt.Errorf("supabase HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return Record{
		ID:         reqID,
		PingTime:   start,
		Status:     "SUCCESS",
		DurationMs: duration,
	}, nil
}

func (s *SupabaseDriver) QueryLatest(ctx context.Context, limit int) ([]Record, error) {
	if limit <= 0 {
		limit = 10
	}
	url := fmt.Sprintf("%s?select=id,ping_time,status&order=ping_time.desc&limit=%s", s.endpoint, strconv.Itoa(limit))
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", s.cfg.Key)
	req.Header.Set("Authorization", "Bearer "+s.cfg.Key)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("supabase HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var rawRows []struct {
		ID       any    `json:"id"`
		PingTime string `json:"ping_time"`
		Status   string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rawRows); err != nil {
		return nil, err
	}

	records := make([]Record, 0, len(rawRows))
	for _, row := range rawRows {
		t, _ := time.Parse(time.RFC3339Nano, row.PingTime)
		records = append(records, Record{
			ID:       fmt.Sprintf("%v", row.ID),
			PingTime: t,
			Status:   row.Status,
		})
	}
	return records, nil
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
