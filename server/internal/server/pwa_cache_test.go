package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"chtozverchu/internal/config"
)

func TestPWAControlFilesCannotBeHeldBySharedCaches(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{
		"index.html":           "<html>latest shell</html>",
		"sw.js":                "self.addEventListener('install', () => {});",
		"pwa-update-guard.js":  "self.addEventListener('message', () => {});",
		"manifest.webmanifest": `{"name":"show"}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{cfg: config.Config{WebDir: dir}}
	for _, path := range []string{"/", "/index.html", "/sw.js", "/pwa-update-guard.js", "/manifest.webmanifest", "/show"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			s.static(w, httptest.NewRequest("GET", path, nil))
			wantStatus := 200
			if path == "/index.html" {
				wantStatus = 301
			}
			if w.Code != wantStatus || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
				t.Fatal("PWA control response can outlive the deployed release")
			}
		})
	}
}
