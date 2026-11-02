package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"chtozverchu/internal/config"
	"chtozverchu/internal/game"
	"chtozverchu/internal/server"
	"chtozverchu/internal/store"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	var catalog *store.Catalog
	var db *store.DB
	if cfg.DatabaseURL == "" {
		log.Printf("DATABASE_URL empty — using embedded catalog (no accounts/history)")
		c, err := store.EmbeddedCatalog()
		if err != nil {
			log.Fatalf("embedded catalog: %v", err)
		}
		catalog = c
	} else if conn, err := store.Connect(ctx, cfg.DatabaseURL); err != nil {
		// Stay up even if Postgres is unreachable: the game is fully playable
		// in embedded mode; accounts/history simply require a working DB.
		log.Printf("postgres unavailable (%v) — falling back to embedded catalog. "+
			"Point DATABASE_URL at a reachable Postgres to enable accounts/history.", err)
		c, e2 := store.EmbeddedCatalog()
		if e2 != nil {
			log.Fatalf("embedded catalog: %v", e2)
		}
		catalog = c
	} else {
		defer conn.Close()
		if err := conn.Migrate(ctx); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		if err := conn.Seed(ctx); err != nil {
			log.Fatalf("seed: %v", err)
		}
		catalog, err = conn.LoadCatalog(ctx)
		if err != nil {
			log.Fatalf("catalog: %v", err)
		}
		db = conn
	}
	log.Printf("catalog loaded: %d songs", len(catalog.Songs("")))

	var cache *store.Cache
	if cfg.RedisURL != "" {
		c, err := store.ConnectRedis(ctx, cfg.RedisURL)
		if err != nil {
			log.Printf("redis unavailable; network rooms disabled")
		} else {
			cache = c
			defer cache.Close()
		}
	}

	engine := game.NewEngine(catalog)
	hub := server.NewHub(engine, cache, db, cfg.JWTSecret)
	srv := server.New(cfg, hub, catalog, db)
	defer srv.Close()

	httpSrv := &http.Server{
		Addr:              cfg.Host + ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("Хто зверху? online — listening on :%s", cfg.Port)
	stopping, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- httpSrv.ListenAndServe() }()
	select {
	case <-stopping.Done():
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	case err := <-errorsCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http: %v", err)
		}
	}
}
