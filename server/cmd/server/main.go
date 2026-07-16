package main

import (
	"context"
	"log"
	"net/http"
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
	if cfg.DatabaseURL == "" {
		log.Printf("DATABASE_URL empty — using embedded catalog (no persistence)")
		c, err := store.EmbeddedCatalog()
		if err != nil {
			log.Fatalf("embedded catalog: %v", err)
		}
		catalog = c
	} else {
		db, err := store.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
		defer db.Close()
		if err := db.Migrate(ctx); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		if err := db.Seed(ctx); err != nil {
			log.Fatalf("seed: %v", err)
		}
		catalog, err = db.LoadCatalog(ctx)
		if err != nil {
			log.Fatalf("catalog: %v", err)
		}
	}
	log.Printf("catalog loaded: %d songs", len(catalog.Songs("")))

	var cache *store.Cache
	if cfg.RedisURL != "" {
		c, err := store.ConnectRedis(ctx, cfg.RedisURL)
		if err != nil {
			log.Printf("redis unavailable, running without persistence: %v", err)
		} else {
			cache = c
		}
	}

	engine := game.NewEngine(catalog)
	hub := server.NewHub(engine, cache)
	srv := server.New(cfg, hub, catalog)

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("Хто зверху? online — listening on :%s", cfg.Port)
	if err := httpSrv.ListenAndServe(); err != nil {
		log.Fatalf("http: %v", err)
	}
}
