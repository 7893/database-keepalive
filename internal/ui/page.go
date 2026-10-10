package ui

import (
	"bytes"
	"embed"
	"encoding/json"
	"html/template"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/geo"
)

//go:embed templates/*.html static/*
var assets embed.FS
var page = template.Must(template.ParseFS(assets, "templates/page.html"))

type Card struct {
	Service          config.Service
	Data             db.Result
	Body, Pagination template.HTML
}

func Render(stats map[string]db.Result, c config.Config) ([]byte, error) {
	cards := []Card{}
	for _, s := range c.Display() {
		r := stats[s.ID]
		cards = append(cards, Card{s, r, renderRows(r), pagination(r)})
	}
	css := []byte{}
	for _, name := range []string{"layout", "tables", "pagination"} {
		b, _ := assets.ReadFile("static/" + name + ".css")
		css = append(css, b...)
	}
	display := c.Catalog().Display
	css = append(css, fontStyles(display)...)
	script := []byte{}
	for _, name := range []string{"fonts", "renderers", "client"} {
		b, _ := assets.ReadFile("static/" + name + ".js")
		script = append(script, b...)
		script = append(script, '\n')
	}
	settings, _ := json.Marshal(display)
	locations := map[string]map[string]string{}
	for _, p := range geo.Pops {
		locations[p.Colo] = map[string]string{"city": p.City, "country": p.Country}
	}
	geography, _ := json.Marshal(locations)
	var out bytes.Buffer
	// CSS and JavaScript are embedded project assets, never upstream or request data.
	e := page.Execute(&out, struct {
		Cards     []Card
		CSS       template.CSS
		Settings  template.JS
		Locations template.JS
		JS        template.JS
	}{cards, template.CSS(css), template.JS(settings), template.JS(geography), template.JS(script)})
	return out.Bytes(), e
}
