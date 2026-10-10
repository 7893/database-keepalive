package db

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

func HTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("upstream_redirect") }}
}

type httpStore struct {
	size                     int
	client                   *http.Client
	url, user, password, key string
}

func (s *httpStore) SetPageSize(size int) { s.size = size }
func (s *httpStore) pageSize() int {
	if s.size > 0 {
		return s.size
	}
	return PageSize
}

func (s *httpStore) request(ctx context.Context, method, url string, body any, headers map[string]string) ([]byte, http.Header, int, error) {
	var data []byte
	var e error
	if body != nil {
		data, e = json.Marshal(body)
		if e != nil {
			return nil, nil, 0, e
		}
	}
	req, e := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(data))
	if e != nil {
		return nil, nil, 0, e
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if s.key != "" {
		req.Header.Set("apikey", s.key)
		req.Header.Set("Authorization", "Bearer "+s.key)
	} else {
		req.SetBasicAuth(s.user, s.password)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, e := s.client.Do(req)
	if e != nil {
		return nil, nil, 0, e
	}
	defer res.Body.Close()
	data, e = io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if e != nil {
		return nil, nil, 0, e
	}
	if len(data) > 2*1024*1024 {
		return nil, nil, res.StatusCode, errors.New("upstream_body_too_large")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, nil, res.StatusCode, errors.New("upstream_status")
	}
	return data, res.Header, res.StatusCode, nil
}
