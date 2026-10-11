package ui

import (
	"fmt"
	"html"
	"html/template"
	"sort"
	"strings"
	"time"

	"github.com/7893/database-keepalive/internal/db"
)

func timestamp(value, timezone string) string {
	if value == "" {
		return "—"
	}
	t, e := time.Parse(time.RFC3339Nano, value)
	if e != nil {
		// Legacy ORDS timestamps can omit the UTC suffix; runtime and browser
		// previously interpreted these records in UTC.
		for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999", "2006-01-02"} {
			t, e = time.ParseInLocation(layout, value, time.UTC)
			if e == nil {
				break
			}
		}
	}
	if e != nil {
		return value
	}
	loc, e := time.LoadLocation(timezone)
	if e != nil {
		loc = time.UTC
	}
	return t.In(loc).Format("2006-01-02 15:04:05")
}
func renderRows(result db.Result, timezone string) template.HTML {
	if !result.OK {
		return template.HTML(`<li class="empty">Unable to load history (` + html.EscapeString(result.Error) + `)</li>`)
	}
	if len(result.Rows) == 0 {
		return `<li class="empty">No check-ins yet</li>`
	}
	var body strings.Builder
	for _, r := range result.Rows {
		status, dot := "Failed", "fail"
		if r.Status == "SUCCESS" {
			status = "Success"
			dot = "ok"
		}
		fmt.Fprintf(&body, `<li class="check-in"><span class="status-dot %s" aria-hidden="true"></span><span class="check-in-detail"><span class="check-in-time">%s</span><span class="check-in-id">Record #%d</span></span><span class="check-in-status %s">%s</span></li>`, dot, html.EscapeString(timestamp(r.PingTime, timezone)), r.ID, dot, status)
	}
	return template.HTML(body.String())
}
func pagination(result db.Result) template.HTML {
	if result.Count == 0 {
		return ""
	}
	current, total := result.Page, int(result.TotalPages)
	if total > 10000 {
		total = 10000
	}
	candidates := []int{1, current - 1, current, current + 1, total}
	sort.Ints(candidates)
	var pages strings.Builder
	previous := 0
	for _, v := range candidates {
		if v < 1 || v > total || v == previous {
			continue
		}
		if previous != 0 && v-previous > 1 {
			pages.WriteString(`<span class="page-ellipsis">…</span>`)
		}
		active := ""
		if v == current {
			active = " active"
		}
		fmt.Fprintf(&pages, `<a href="javascript:void(0)" class="page-num%s" data-page="%d">%d</a>`, active, v, v)
		previous = v
	}
	prev, next := `tabindex="-1" aria-disabled="true"`, `tabindex="-1" aria-disabled="true"`
	pd, nd := " disabled", " disabled"
	if current > 1 {
		prev = fmt.Sprintf(`data-page="%d"`, current-1)
		pd = ""
	}
	if current < total {
		next = fmt.Sprintf(`data-page="%d"`, current+1)
		nd = ""
	}
	return template.HTML(fmt.Sprintf(`<div class="pagination"><div class="pagination-info">Page <span class="cur-page">%d</span> / <span class="total-pages">%d</span> <span class="total-count">(%d records)</span></div><div class="pagination-controls"><a href="javascript:void(0)" class="page-btn%s" %s>Previous</a><div class="page-numbers">%s</div><a href="javascript:void(0)" class="page-btn%s" %s>Next</a></div></div>`, current, total, result.Count, pd, prev, pages.String(), nd, next))
}
