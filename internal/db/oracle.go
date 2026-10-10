package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type Oracle struct{ httpStore }
type sqlItem struct {
	StatementID  *json.Number    `json:"statementId"`
	ErrorDetails json.RawMessage `json:"errorDetails"`
	ErrorCode    json.RawMessage `json:"errorCode"`
	Error        json.RawMessage `json:"error"`
	ResultSet    struct {
		Items json.RawMessage `json:"items"`
	} `json:"resultSet"`
}

func NewOracle(base, user, password string) *Oracle {
	return &Oracle{httpStore{client: HTTPClient(), url: strings.TrimRight(base, "/") + "/_/sql", user: user, password: password}}
}
func truthy(raw json.RawMessage) bool {
	return len(raw) > 0 && string(raw) != "null" && string(raw) != "false" && string(raw) != "0" && string(raw) != `""`
}
func (s *Oracle) execute(ctx context.Context, sql string) ([]sqlItem, error) {
	b, _, _, e := s.request(ctx, "POST", s.url, map[string]string{"statementText": sql}, nil)
	if e != nil {
		return nil, e
	}
	var result struct {
		Items []sqlItem `json:"items"`
	}
	if e = json.Unmarshal(b, &result); e != nil {
		return nil, e
	}
	if len(result.Items) == 0 {
		return nil, errors.New("empty_sql_result")
	}
	for _, i := range result.Items {
		if i.StatementID == nil || truthy(i.Error) || truthy(i.ErrorCode) || truthy(i.ErrorDetails) {
			return nil, errors.New("sql_error")
		}
	}
	return result.Items, nil
}
func (s *Oracle) rows(ctx context.Context, sql string, target any) error {
	items, e := s.execute(ctx, sql)
	if e != nil {
		return e
	}
	if len(items) != 1 || len(items[0].ResultSet.Items) == 0 || items[0].ResultSet.Items[0] != '[' {
		return errors.New("invalid_sql_rows")
	}
	return json.Unmarshal(items[0].ResultSet.Items, target)
}
func literal(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
func (s *Oracle) Ping(ctx context.Context, id string) error {
	statement := "BEGIN INSERT INTO keepalive_log (request_id,status) VALUES (" + literal(id) + ",'SUCCESS'); EXCEPTION WHEN DUP_VAL_ON_INDEX THEN NULL; END;"
	if _, e := s.execute(ctx, statement); e != nil {
		return e
	}
	var rows []Row
	if e := s.rows(ctx, "SELECT request_id,status FROM keepalive_log WHERE request_id="+literal(id), &rows); e != nil {
		return e
	}
	return Confirm(rows, id)
}

func (s *Oracle) Query(ctx context.Context, page int) (Result, error) {
	limit := s.pageSize()
	var rows []Row
	if e := s.rows(ctx, fmt.Sprintf("SELECT id,ping_time,status FROM keepalive_log ORDER BY ping_time DESC,id DESC OFFSET %d ROWS FETCH NEXT %d ROWS ONLY", (page-1)*limit, limit), &rows); e != nil {
		return Result{}, e
	}
	var counts []struct {
		Count json.Number `json:"cnt"`
	}
	if e := s.rows(ctx, "SELECT COUNT(*) AS cnt FROM keepalive_log", &counts); e != nil {
		return Result{}, e
	}
	if len(counts) != 1 {
		return Result{}, errors.New("invalid_count")
	}
	count, e := strconv.ParseInt(string(counts[0].Count), 10, 64)
	if e != nil || count < 0 {
		return Result{}, errors.New("invalid_count")
	}
	return Successful(rows, count, page, limit), nil
}
