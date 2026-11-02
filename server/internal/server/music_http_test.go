package server

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type musicTransport func(*http.Request) (*http.Response, error)

func (f musicTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func musicResponse(code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}
func musicJWT() string {
	return "header." + base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, time.Now().Add(time.Hour).Unix()))) + ".signature"
}
func TestStudioTrackKeepsCueTimesAndSecretsPrivate(t *testing.T) {
	token := musicJWT()
	calls := 0
	a := &musicAdapter{token: token, cache: map[string]musicCache{}, http: &http.Client{Transport: musicTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host == "api.deezer.com" {
			return musicResponse(200, `{"id":123,"title":"Test","duration":60,"preview":"https://example.test/preview.mp3"}`), nil
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Fatal("missing server-only auth")
		}
		return musicResponse(200, `{"data":{"track":{"lyrics":{"synchronizedLines":[{"milliseconds":3000,"duration":0,"line":"Другий рядок"},{"milliseconds":1000,"duration":9000,"line":"Перший рядок"}]}}}}`), nil
	})}}
	rec := httptest.NewRecorder()
	a.track(rec, httptest.NewRequest("GET", "/api/music/track?id=123", nil))
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, `"lyricsStatus":"ready"`) || !strings.Contains(body, `"startMs":1000,"endMs":3000`) {
		t.Fatalf("bad timeline response: %s", body)
	}
	if strings.Contains(body, token) || strings.Contains(body, "Authorization") {
		t.Fatal("provider credential leaked")
	}
	again := httptest.NewRecorder()
	a.track(again, httptest.NewRequest("GET", "/api/music/track?id=123", nil))
	if calls != 2 {
		t.Fatalf("cache missed: %d provider calls", calls)
	}
}
func TestStudioRejectsInvalidIDBeforeProviderRequest(t *testing.T) {
	a := &musicAdapter{}
	for _, id := range []string{"", "../secret", "0", "-1", "1234567890123456"} {
		rec := httptest.NewRecorder()
		a.track(rec, httptest.NewRequest("GET", "/api/music/track?id="+id, nil))
		if rec.Code != 400 {
			t.Fatalf("accepted id %q", id)
		}
	}
}
func TestStudioProviderRejectionDoesNotExposeResponse(t *testing.T) {
	a := &musicAdapter{token: musicJWT(), cache: map[string]musicCache{}, http: &http.Client{Transport: musicTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "api.deezer.com" {
			return musicResponse(200, `{"id":123,"title":"Test"}`), nil
		}
		return musicResponse(401, `{"error":"private provider details"}`), nil
	})}}
	rec := httptest.NewRecorder()
	a.track(rec, httptest.NewRequest("GET", "/api/music/track?id=123", nil))
	if !strings.Contains(rec.Body.String(), `"lyricsStatus":"reauth_required"`) || strings.Contains(rec.Body.String(), "private provider") {
		t.Fatal("unsafe or ambiguous rejection")
	}
}
