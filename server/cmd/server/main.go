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
	var db *store.DB
	if cfg.DatabaseURL == "" {
		log.Printf("DATABASE_URL empty — using embedded catalog (no accounts/history)")
		c, err := store.EmbeddedCatalog()
		if err != nil {
			log.Fatalf("embedded catalog: %v", err)
		}
		catalog = c
	} else {
		conn, err := store.Connect(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("postgres: %v", err)
		}
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
			log.Printf("redis unavailable, running without persistence: %v", err)
		} else {
			cache = c
		}
	}

	engine := game.NewEngine(catalog)
	hub := server.NewHub(engine, cache, db, cfg.JWTSecret)
	srv := server.New(cfg, hub, catalog, db)

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
