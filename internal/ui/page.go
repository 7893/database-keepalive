package ui

import (
	"bytes"
	"embed"
	"html/template"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/db"
)

//go:embed templates/*.html static/*
var assets embed.FS
var page = template.Must(template.ParseFS(assets, "templates/page.html"))

type Card struct {
	Service          config.Service
	Data             db.Result
	Body, Pagination template.HTML
}

func Render(stats map[string]db.Result) ([]byte, error) {
	cards := []Card{}
	for _, index := range config.Display {
		s := config.Services[index]
		r := stats[s.ID]
		cards = append(cards, Card{s, r, renderRows(r), pagination(r)})
	}
	css := []byte{}
	for _, name := range []string{"layout", "tables", "pagination"} {
		b, _ := assets.ReadFile("static/" + name + ".css")
		css = append(css, b...)
	}
	script, _ := assets.ReadFile("static/client.js")
	var out bytes.Buffer
	// CSS and JavaScript are embedded project assets, never upstream or request data.
	e := page.Execute(&out, struct {
		Cards []Card
		CSS   template.CSS
		JS    template.JS
	}{cards, template.CSS(css), template.JS(script)})
	return out.Bytes(), e
}
