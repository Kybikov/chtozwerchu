package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"chtozverchu/internal/config"
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
)

// Server wires HTTP routes to the hub and content catalog.
type Server struct {
	cluster   *roomCluster
	studio    *studioHub
	once      sync.Once
	closeOnce sync.Once
	handler   http.Handler
	cfg       config.Config
	hub       *Hub
	catalog   *store.Catalog
	db        *store.DB // optional (nil in embedded mode disables accounts)
}

// New builds the HTTP server.
func New(cfg config.Config, hub *Hub, catalog *store.Catalog, db *store.DB) *Server {
	return &Server{cfg: cfg, hub: hub, catalog: catalog, db: db}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	s.once.Do(func() {
		s.setupRoomCluster()
		mux := http.NewServeMux()
		if s.cluster != nil {
			mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) { s.cluster.serveWS("party", w, r) })
		} else if s.cfg.RedisURL != "" {
			mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "Зв’язок із грою відновлюється", 503)
			})
		} else {
			mux.HandleFunc("/ws", s.hub.ServeWS)
		}
		mux.HandleFunc("/health", s.health)
		mux.HandleFunc("/api/health", s.health)
		mux.HandleFunc("/api/meta", s.meta)
		mux.HandleFunc("/api/presets", s.presets)
		mux.HandleFunc("/api/app-shell", s.appShell)
		s.registerAuthRoutes(mux)
		s.registerMusicRoutes(mux)
		s.registerStudioRoutes(mux)
		legacy := os.Getenv("LEGACY_WEB_DIR")
		if legacy == "" {
			legacy = "../web"
		}
		mux.Handle("/classic/", http.StripPrefix("/classic/", http.FileServer(http.Dir(legacy))))
		mux.HandleFunc("/", s.static)
		s.handler = mux
	})
	return s.handler
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ok := true
	if s.cfg.DatabaseURL != "" {
		if s.db == nil {
			ok = false
		} else {
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			ok = s.db.Pool().Ping(ctx) == nil
			cancel()
		}
	}
	if s.cfg.RedisURL != "" && s.hub.cache == nil {
		ok = false
	}
	if s.cfg.RedisURL != "" {
		if s.cluster == nil || !s.cluster.ready.Load() {
			ok = false
		} else {
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			if s.hub.cache.Ping(ctx) != nil {
				ok = false
			}
			cancel()
		}
	}
	status := http.StatusOK
	if !ok {
		status = http.StatusServiceUnavailable
	}
	w.Header().Set("Cache-Control", "no-store")
	transport := "memory"
	if s.cfg.RedisURL != "" {
		transport = "unavailable"
		if s.cluster != nil && s.cluster.ready.Load() {
			transport = "redis"
		}
	}
	writeJSON(w, status, map[string]any{"ok": ok, "version": "1.37.0", "commit": os.Getenv("SOURCE_COMMIT"), "accounts": s.db != nil, "roomTransport": transport})
}

// roundTypeName maps round types to Ukrainian display names.
var roundTypeName = map[game.RoundType]string{
	game.RoundFiveWords: "5 слів",
	game.RoundMelody:    "Вгадай мелодію",
	game.RoundAlias:     "Аліас",
	game.RoundCrocodile: "Крокодил",
	game.RoundTruthLie:  "Правда чи брехня",
}

// orderedRoundTypes keeps a stable, user-facing order.
var orderedRoundTypes = []game.RoundType{
	game.RoundFiveWords,
	game.RoundMelody,
	game.RoundAlias,
	game.RoundCrocodile,
	game.RoundTruthLie,
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	types := make([]map[string]any, 0, len(orderedRoundTypes))
	for _, t := range orderedRoundTypes {
		if _, err := game.Handler(t); err != nil {
			continue
		}
		types = append(types, map[string]any{"id": t, "name": roundTypeName[t]})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"roundTypes": types,
		"presets":    s.catalog.Presets(),
	})
}

func (s *Server) presets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"presets": s.catalog.Presets()})
}

// The API navigation denylist lets an idle window fetch the deployed shell
// even when an older offline worker cannot complete an update handshake.
func (s *Server) appShell(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	w.Header().Set("X-Robots-Tag", "noindex, noarchive")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, "index.html"))
}

// static serves the web directory with an index.html SPA fallback.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	clean := filepath.ToSlash(filepath.Clean(r.URL.Path))
	if clean == "/" || clean == "." {
		clean = "/index.html"
	}
	path := filepath.Join(s.cfg.WebDir, clean)
	// Prevent path traversal outside the web dir.
	if !strings.HasPrefix(path, filepath.Clean(s.cfg.WebDir)) {
		http.NotFound(w, r)
		return
	}
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if clean == "/sw.js" || clean == "/pwa-update-guard.js" || clean == "/manifest.webmanifest" || strings.HasSuffix(clean, ".html") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		}
		http.ServeFile(w, r, path)
		return
	}
	// SPA fallback.
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
	http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, "index.html"))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
