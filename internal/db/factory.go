package db

import (
	"errors"
	"github.com/7893/database-keepalive/internal/config"
)

func newBackend(kind string, c config.Config) (Backend, error) {
	var b Backend
	var e error
	switch kind {
	case "supabase":
		b = NewSupabase(c.Get("SUPABASE_URL"), c.Get("SUPABASE_SECRET_KEY"))
	case "adb":
		b = NewOracle(c.Get("ADB_URL"), c.Get("ADB_USER"), c.Get("ADB_PASS"))
	case "db2":
		b, e = NewDb2(c)
	case "mysql":
		b, e = NewMySQL(c)
	default:
		return nil, errors.New("unknown database type")
	}
	if e != nil {
		return nil, e
	}
	if size, ok := b.(interface{ SetPageSize(int) }); ok {
		size.SetPageSize(c.Catalog().Display.PageSize)
	}
	return b, e
}
