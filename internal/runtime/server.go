package runtime

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/db"
	"github.com/7893/keepalive/internal/web"
)

func Run(ctx context.Context, c config.Config) error {
	if e := os.WriteFile(c.Get("MYSQL_SSL_CA"), []byte(c.Get("MYSQL_CA_PEM")), 0600); e != nil {
		return errors.New("unable to write mysql CA")
	}
	if e := os.Chmod(c.Get("MYSQL_SSL_CA"), 0600); e != nil {
		return errors.New("unable to protect mysql CA")
	}
	registry, e := db.NewRegistry(c)
	if e != nil {
		return e
	}
	defer registry.Close()
	tunnel := exec.Command("cloudflared", "access", "tcp", "--hostname", c.Get("TUNNEL_SERVICE_HOSTNAME"), "--url", net.JoinHostPort(c.Get("MYSQL_HOST"), c.Get("MYSQL_PORT")))
	tunnel.Stdout = io.Discard
	tunnel.Stderr = io.Discard
	if e = tunnel.Start(); e != nil {
		return errors.New("unable to start cloudflared")
	}
	defer tunnel.Process.Kill()
	tunnelExit := make(chan error, 1)
	go func() { tunnelExit <- tunnel.Wait() }()
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
