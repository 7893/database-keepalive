package ui

import (
	"github.com/7893/database-keepalive/internal/db"
	"strings"
	"testing"
)

func TestLegacyTimesAndEscaping(t *testing.T) {
	for _, stamp := range []string{"2026-10-10T20:59:01Z", "2026-10-10T20:59:01", "2026-10-10 20:59:01"} {
		if got := timestamp(stamp, "Asia/Singapore"); got != "2026-10-11 04:59:01" {
			t.Fatalf("%s: %s", stamp, got)
		}
	}
	if timestamp("<time>", "UTC") != "<time>" {
		t.Fatal("invalid timestamp changed")
	}
	row := db.Row{ID: 42, Status: "SUCCESS"}
	row.PingTime = "<time>"
	rendered := string(renderRows(db.Successful([]db.Row{row}, 101, 5), "UTC"))
	if strings.Contains(rendered, "<script>") || !strings.Contains(rendered, "&lt;time&gt;") {
		t.Fatal("unsafe rendering")
	}
	controls := string(pagination(db.Successful(nil, 101, 5)))
	if !strings.Contains(controls, `data-page="4"`) || !strings.Contains(controls, `data-page="6"`) || !strings.Contains(controls, "page-ellipsis") {
		t.Fatal("pagination changed")
	}
}
