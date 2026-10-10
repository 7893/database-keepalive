package runtime

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/web"
)

func Run(ctx context.Context, c config.Config) error {
	if e := prepareCertificates(c); e != nil {
		return e
	}
	registry, e := db.NewRegistry(c)
	if e != nil {
		return e
	}
	defer registry.Close()
	tunnelExit, stopTunnels, e := startTunnels(c)
	if e != nil {
		return e
	}
	defer stopTunnels()
	handler := web.New(registry)
	server := &http.Server{Addr: net.JoinHostPort("0.0.0.0", c.Get("PORT")), Handler: safe(handler), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 240 * time.Second, WriteTimeout: 240 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 * 1024, ErrorLog: log.New(io.Discard, "", 0)}
	serverExit := make(chan error, 1)
	go func() { serverExit <- server.ListenAndServe() }()
	log.Print(`{"event":"service_ready"}`)
	var failure error
	select {
	case <-ctx.Done():
	case <-tunnelExit:
		failure = errors.New("cloudflared stopped")
	case e := <-serverExit:
		if !errors.Is(e, http.ErrServerClosed) {
			failure = errors.New("HTTP server stopped")
		}
	}
	shutdown, stop := context.WithTimeout(context.Background(), 8*time.Second)
	defer stop()
	server.Shutdown(shutdown)
	server.Close()
	return failure
}
func safe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				log.Print(`{"event":"request_failed"}`)
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("X-Content-Type-Options", "nosniff")
				http.Error(w, "Internal error", 500)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
