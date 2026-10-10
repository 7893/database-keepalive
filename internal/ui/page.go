package ui

import (
	"bytes"
	"embed"
	"encoding/json"
	"html/template"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
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
	model := c.Catalog()
	for _, s := range c.Display() {
		r := stats[s.ID]
		cards = append(cards, Card{s, r, renderRows(r, model.Schedule.Timezone), pagination(r)})
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
	settings, _ := json.Marshal(struct {
		config.Display
		Timezone string `json:"timezone"`
	}{display, model.Schedule.Timezone})
	var out bytes.Buffer
	// CSS and JavaScript are embedded project assets, never upstream or request data.
	e := page.Execute(&out, struct {
		Cards    []Card
		CSS      template.CSS
		Settings template.JS
		Schedule config.Schedule
		JS       template.JS
	}{cards, template.CSS(css), template.JS(settings), model.Schedule, template.JS(script)})
	return out.Bytes(), e
}
