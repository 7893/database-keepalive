// Check project structure and likely secrets without printing credential values.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/format"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/7893/database-keepalive/internal/config"
	"go.yaml.in/yaml/v3"
)

var code = map[string]bool{".go": true, ".js": true, ".css": true, ".sql": true, ".json": true, ".yaml": true, ".yml": true, ".html": true}
var skip = map[string]bool{".git": true, "node_modules": true, "vendor": true, ".wrangler": true, "coverage": true, "__pycache__": true}
var patterns = []*regexp.Regexp{
	regexp.MustCompile(`-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----`),
	regexp.MustCompile(`AKIA[0-9A-Z]{16}`), regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{20,}`),
	regexp.MustCompile(`sk-[A-Za-z0-9_-]{20,}`), regexp.MustCompile(`xox[baprs]-[A-Za-z0-9-]{20,}`),
	regexp.MustCompile(`AIza[0-9A-Za-z_-]{30,}`),
	regexp.MustCompile(`(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?):\/\/[^/\s:@]+:[^/\s@]+@`),
}
var assignment = regexp.MustCompile(`\b([A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASS))\b\s*[:=]\s*["']?([^"',\s}]+)`)
var placeholder = regexp.MustCompile(`(?i)(example|fake|placeholder|replace|sample|test|your[-_])`)

func main() {
	failed, count := false, 0
	report := func(path, reason string) { fmt.Fprintf(os.Stderr, "%s: %s\n", path, reason); failed = true }
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			if skip[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		ext := filepath.Ext(path)
		text := code[ext] || ext == ".md" || ext == ".example" || ext == ".env" || ext == ".txt" || d.Name() == "Dockerfile"
		if !text {
			return nil
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		count++
		if code[ext] || d.Name() == "Dockerfile" {
			lines := bytes.Count(bytes.TrimSuffix(data, []byte("\n")), []byte("\n")) + 1
			if lines > 300 {
				report(path, fmt.Sprintf("%d lines; maximum 300", lines))
			}
		}
		if ext == ".go" {
			formatted, e := format.Source(data)
			if e != nil || !bytes.Equal(formatted, data) {
				report(path, "run gofmt")
			}
		}
		if ext == ".json" && !json.Valid(data) {
			report(path, "invalid JSON")
		}
		if ext == ".yaml" || ext == ".yml" {
			decoder := yaml.NewDecoder(bytes.NewReader(data))
			if decoder.Decode(new(any)) != nil || decoder.Decode(new(any)) != io.EOF {
				report(path, "invalid YAML or multiple documents")
			}
		}
		if path == "config.yaml" {
			if _, e := config.Parse(data); e != nil {
				report(path, e.Error())
			}
		}
		if path == "cmd/check/main.go" {
			return nil
		}
		for _, p := range patterns {
			if p.Match(data) {
				report(path, "possible secret")
			}
		}
		for _, match := range assignment.FindAllSubmatch(data, -1) {
			value := string(match[2])
			if !placeholder.MatchString(value) && !strings.HasPrefix(value, "$") {
				report(path, "possible credential assignment")
			}
		}
		return nil
	})
	if err != nil {
		report("project", err.Error())
	}
	if failed {
		os.Exit(1)
	}
	fmt.Printf("Checked %d text files: structure, Go formatting, JSON/YAML and likely secrets.\n", count)
}
