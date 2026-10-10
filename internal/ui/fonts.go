package ui

import (
	"strings"

	"github.com/7893/database-keepalive/internal/config"
)

// Names are validated by config.Parse before being used in CSS.
func fontStack(fonts []string, fallback string) string {
	values := []string{}
	for _, font := range fonts {
		if genericFont(font) {
			values = append(values, font)
		} else {
			values = append(values, "'"+font+"'")
		}
	}
	return strings.Join(append(values, fallback), ",")
}
func genericFont(name string) bool {
	switch name {
	case "serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong":
		return true
	}
	return false
}
func fontStyles(d config.Display) []byte {
	return []byte(":root{--font-body:" + fontStack(d.Fonts, "system-ui,sans-serif") + ";--font-mono:" + fontStack(d.MonoFonts, "monospace") + ";}")
}
