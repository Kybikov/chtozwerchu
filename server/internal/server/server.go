package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"chtozverchu/internal/config"
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
)

// Server wires HTTP routes to the hub and content catalog.
type Server struct {
	cfg     config.Config
	hub     *Hub
	catalog *store.Catalog
	db      *store.DB // optional (nil in embedded mode disables accounts)
}

// New builds the HTTP server.
func New(cfg config.Config, hub *Hub, catalog *store.Catalog, db *store.DB) *Server {
	return &Server{cfg: cfg, hub: hub, catalog: catalog, db: db}
}

// Handler returns the root HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.hub.ServeWS)
	mux.HandleFunc("/health", s.health)
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/meta", s.meta)
	mux.HandleFunc("/api/presets", s.presets)
	s.registerAuthRoutes(mux)
	mux.HandleFunc("/", s.static)
	return mux
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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

// static serves the web directory with an index.html SPA fallback.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean(r.URL.Path)
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
		http.ServeFile(w, r, path)
		return
	}
	// SPA fallback.
	http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, "index.html"))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
