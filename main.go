package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/7893/database-keepalive/internal/config"
	"github.com/7893/database-keepalive/internal/db"
	"github.com/7893/database-keepalive/internal/scheduler"
	"github.com/7893/database-keepalive/internal/web"
)

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", "", "Path to configuration file")
	flag.StringVar(&configPath, "c", "", "Path to configuration file (shorthand)")
	flag.Parse()

	args := flag.Args()
	cmd := "daemon"
	if len(args) > 0 {
		cmd = args[0]
	}

	// Also parse -c / -config if provided after subcommand (e.g. `database-keepalive tick -c file.yaml`)
	if configPath == "" && len(args) > 1 {
		for i := 1; i < len(args); i++ {
			if (args[i] == "-c" || args[i] == "-config") && i+1 < len(args) {
				configPath = args[i+1]
				break
			}
		}
	}

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("❌ Failed to load configuration: %v", err)
	}

	drivers := make([]db.Driver, 0, len(cfg.Instances))
	for _, inst := range cfg.Instances {
		d, err := db.NewDriver(inst)
		if err != nil {
			log.Printf("⚠️ Skip instance %s: %v", inst.ID, err)
			continue
		}
		drivers = append(drivers, d)
	}

	if len(drivers) == 0 {
		log.Fatalf("❌ No valid database instances configured")
	}

	planner := scheduler.NewPlanner(cfg.Schedule)

	switch cmd {
	case "tick", "check", "run":
		runTick(drivers)
	case "serve":
		runServer(cfg, drivers, planner, false)
	case "daemon":
		runDaemon(cfg, drivers, planner)
	default:
		fmt.Printf("Usage: %s [tick|serve|daemon] [-c config.yaml]\n", os.Args[0])
		os.Exit(1)
	}
}

func runTick(drivers []db.Driver) {
	fmt.Printf("🚀 Running check-in for %d database instance(s)...\n", len(drivers))
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	allSuccess := true
	var mu sync.Mutex

	for _, d := range drivers {
		wg.Add(1)
		go func(driver db.Driver) {
			defer wg.Done()
			rec, err := driver.Ping(ctx)
			mu.Lock()
			defer mu.Unlock()

			if err != nil {
				allSuccess = false
				fmt.Printf("  [✗] %-24s 🔴 FAILED (%dms): %v\n", driver.Name(), rec.DurationMs, err)
			} else {
				fmt.Printf("  [✓] %-24s 🟢 SUCCESS (%dms)\n", driver.Name(), rec.DurationMs)
			}
			_ = driver.Close()
		}(d)
	}

	wg.Wait()
	if !allSuccess {
		os.Exit(1)
	}
}

func runDaemon(cfg *config.Config, drivers []db.Driver, planner *scheduler.Planner) {
	fmt.Println("==================================================")
	fmt.Printf("🚀 Database Keepalive starting (%d instances loaded)\n", len(drivers))
	fmt.Printf("⏰ Schedule policy: %s (Timezone: %s)\n", formatSchedule(cfg.Schedule), cfg.Schedule.Timezone)
	fmt.Printf("🌐 Web dashboard:   http://localhost%s\n", cfg.Server.Listen)
	fmt.Println("==================================================")

	// 1. Perform initial startup check-in test
	fmt.Println("👉 Running initial startup check-in test...")
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	var wg sync.WaitGroup
	for _, d := range drivers {
		wg.Add(1)
		go func(driver db.Driver) {
			defer wg.Done()
			rec, err := driver.Ping(ctx)
			planner.RecordPing(driver.ID(), rec)
			if err != nil {
				fmt.Printf("  -> %-24s 🔴 FAILED: %v\n", driver.Name(), err)
			} else {
				fmt.Printf("  -> %-24s 🟢 SUCCESS (%dms)\n", driver.Name(), rec.DurationMs)
			}
		}(d)
	}
	wg.Wait()
	cancel()

	// 2. Start background autonomous scheduler
	planner.StartScheduler(drivers, func(d db.Driver) {
		tCtx, tCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer tCancel()
		rec, err := d.Ping(tCtx)
		planner.RecordPing(d.ID(), rec)
		if err != nil {
			log.Printf("[Schedule Ping] %s FAILED: %v", d.Name(), err)
		} else {
			log.Printf("[Schedule Ping] %s SUCCESS (%dms)", d.Name(), rec.DurationMs)
		}
	})

	// 3. Start HTTP server
	runServer(cfg, drivers, planner, true)
}

func runServer(cfg *config.Config, drivers []db.Driver, planner *scheduler.Planner, isDaemon bool) {
	srv, err := web.NewServer(cfg, drivers, planner)
	if err != nil {
		log.Fatalf("❌ Failed to init web server: %v", err)
	}

	httpServer := &http.Server{
		Addr:         cfg.Server.Listen,
		Handler:      srv.Handler(),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if !isDaemon {
			fmt.Printf("🌐 Web dashboard running on http://localhost%s\n", cfg.Server.Listen)
		}
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ HTTP server error: %v", err)
		}
	}()

	<-stop
	fmt.Println("\n🛑 Shutting down gracefully...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)

	for _, d := range drivers {
		_ = d.Close()
	}
	fmt.Println("👋 Done.")
}

func formatSchedule(s config.ScheduleConfig) string {
	if s.Count > 0 {
		return fmt.Sprintf("Fixed %d times/day (randomized HH:MM:SS)", s.Count)
	}
	return fmt.Sprintf("Random %d~%d times/day (randomized HH:MM:SS)", s.Min, s.Max)
}
