package ui

import (
	"fmt"
	"html"
	"html/template"
	"sort"
	"strings"
	"time"

	"github.com/7893/keepalive/internal/db"
	"github.com/7893/keepalive/internal/geo"
)

func flag(country string) string {
	if len(country) != 2 {
		return "🌐"
	}
	b := []rune(strings.ToUpper(country))
	return string([]rune{b[0] + 127397, b[1] + 127397})
}
func location(row db.Row) string {
	if row.Colo == "" && row.Country == "" {
		return "—"
	}
	country, city := row.Country, row.City
	for _, p := range geo.Pops {
		if p.Colo == row.Colo && (city == "Edge" || city == "" || country == "XX" || (row.Colo == "SIN" && country == "US")) {
			city = p.City
			country = p.Country
			break
		}
	}
	if city == "" {
		city = country
	}
	result := flag(country) + " " + city
	if row.Colo != "" {
		result += " (" + row.Colo + ")"
	}
	return result
}
func timestamp(value string) string {
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
	return t.In(time.FixedZone("HKT", 8*3600)).Format("01-02 15:04:05")
}
func renderRows(result db.Result) template.HTML {
	if !result.OK {
		return template.HTML(`<tr><td colspan="4" class="empty">Unable to load data (` + html.EscapeString(result.Error) + `)</td></tr>`)
	}
	if len(result.Rows) == 0 {
		return `<tr><td colspan="4" class="empty">No records yet</td></tr>`
	}
	var body strings.Builder
	for _, r := range result.Rows {
		status, dot := "Failed", "fail"
		if r.Status == "SUCCESS" {
			status = "Success"
			dot = "ok"
		}
		ip := r.IP
		if ip == "" {
			ip = "—"
		}
		fmt.Fprintf(&body, `<tr><td class="col-time">%s</td><td class="col-status"><div class="status-badge"><span class="status-dot %s"></span><span class="status-text">%s</span></div></td><td class="col-loc">%s</td><td class="col-ip"><code>%s</code></td></tr>`, html.EscapeString(timestamp(r.PingTime)), dot, status, html.EscapeString(location(r)), html.EscapeString(ip))
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
	return template.HTML(fmt.Sprintf(`<div class="pagination"><div class="pagination-info">第 <span class="cur-page">%d</span> / <span class="total-pages">%d</span> 页 <span class="total-count">（共 %d 条）</span></div><div class="pagination-controls"><a href="javascript:void(0)" class="page-btn%s" %s>上一页</a><div class="page-numbers">%s</div><a href="javascript:void(0)" class="page-btn%s" %s>下一页</a></div></div>`, current, total, result.Count, pd, prev, pages.String(), nd, next))
}
