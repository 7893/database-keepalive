package databasekeepalive

import _ "embed"

//go:embed config.yaml
var settings string

// DefaultSettings returns the single project configuration embedded in builds.
func DefaultSettings() []byte { return []byte(settings) }
