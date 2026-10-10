// Read deployment targets from the same configuration embedded in the app.
package main

import (
	"fmt"
	"os"

	"github.com/7893/database-keepalive/internal/config"
)

func main() {
	data, e := os.ReadFile("config.yaml")
	if e != nil {
		fail("unable to read config.yaml")
	}
	m, e := config.Parse(data)
	if e != nil {
		fail(e.Error())
	}
	d := m.Deployment
	if d.Project == "" || d.Region == "" || d.Service == "" {
		fail("deployment requires project, region and service")
	}
	// Validated identifiers are safe to use as GitHub environment entries.
	fmt.Printf("PROJECT=%s\nREGION=%s\nSERVICE=%s\nREPOSITORY=%s\n", d.Project, d.Region, d.Service, d.Repository)
}
func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
