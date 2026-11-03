package server

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"chtozverchu/internal/config"
)

func TestPWARecoveryServesTheDeployedShellWithoutRedirectOrCache(t *testing.T) {
	dir := t.TempDir()
	s := &Server{cfg: config.Config{WebDir: dir}}
	for _, shell := range []string{"<html>previous release</html>", "<html>current release</html>"} {
		if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(shell), 0600); err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		s.appShell(w, httptest.NewRequest("GET", "/api/app-shell?screen=remote&code=ABC12", nil))
		if w.Code != 200 || w.Body.String() != shell || w.Header().Get("Location") != "" {
			t.Fatal("recovery must return the deployed shell directly, retaining the entry URL")
		}
		if !strings.Contains(w.Header().Get("Cache-Control"), "no-store") || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") || w.Header().Get("X-Robots-Tag") != "noindex, noarchive" {
			t.Fatal("recovery must be an uncached HTML response excluded from indexing")
		}
	}
	w := httptest.NewRecorder()
	s.appShell(w, httptest.NewRequest("HEAD", "/api/app-shell", nil))
	if w.Code != 200 || w.Body.Len() != 0 {
		t.Fatal("HEAD recovery must not return an HTML body")
	}
}

func TestPWARecoveryRejectsMutationMethods(t *testing.T) {
	s := &Server{cfg: config.Config{WebDir: t.TempDir()}}
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		w := httptest.NewRecorder()
		s.appShell(w, httptest.NewRequest(method, "/api/app-shell", nil))
		if w.Code != 405 || w.Header().Get("Allow") != "GET, HEAD" {
			t.Fatalf("%s recovery must be rejected", method)
		}
	}
}
