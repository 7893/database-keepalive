//go:build !db2 || !cgo

package db

import (
	"errors"
	"github.com/7893/database-keepalive/internal/config"
)

// Unit tests on ARM need no proprietary native library. Production builds must use -tags db2.
func NewDb2(config.Config) (*SQLStore, error) {
	return nil, errors.New("Db2 requires a CGO build with -tags db2 and IBM CLI libraries")
}
