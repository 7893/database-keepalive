package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/7893/keepalive/internal/config"
	"github.com/7893/keepalive/internal/runtime"
)

func main() {
	log.SetFlags(0)
	c, e := config.Load()
	if e != nil {
		log.Print(e)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	if e = runtime.Run(ctx, c); e != nil {
		log.Print(e)
		os.Exit(1)
	}
}
