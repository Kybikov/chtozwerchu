package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"chtozverchu/internal/config"
	"chtozverchu/internal/store"
)

func TestAccountValidation(t *testing.T) {
	valid := authReq{Email: "host@example.invalid", Password: "a-long-test-password", DisplayName: "Ведучий"}
	if validAccount(valid) != "" {
		t.Fatal("valid account rejected")
	}
	cases := []authReq{{Email: "invalid", Password: valid.Password, DisplayName: valid.DisplayName}, {Email: valid.Email, Password: "tiny", DisplayName: valid.DisplayName}, {Email: valid.Email, Password: strings.Repeat("x", 73), DisplayName: valid.DisplayName}, {Email: valid.Email, Password: valid.Password, DisplayName: "x"}}
	for _, c := range cases {
		if validAccount(c) == "" {
			t.Fatal("invalid registration accepted")
		}
	}
}
func TestAccountStatusInGuestOnlyMode(t *testing.T) {
	s := &Server{}
	mux := http.NewServeMux()
	s.registerAuthRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/status", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"available":false`) {
		t.Fatal("guest capability was not reported")
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{}`)))
	if rec.Code != 503 {
		t.Fatal("guest-only auth should be unavailable")
	}
}
func TestCookieAccountsAndPrivateHistoryIntegration(t *testing.T) {
	dsn := os.Getenv("KHZ_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KHZ_TEST_DATABASE_URL for isolated Postgres integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := store.Connect(ctx, dsn)
	if err != nil {
		t.Fatal("test database unavailable")
	}
	defer db.Close()
	if err = db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	s := &Server{cfg: config.Config{JWTSecret: "integration-only-secret"}, db: db}
	mux := http.NewServeMux()
	s.registerAuthRoutes(mux)
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	email := fmt.Sprintf("studio-test-%d@example.invalid", time.Now().UnixNano())
	password := "test-account-only-very-long"
	request := func(client *http.Client, method, path string, body any) (*http.Response, map[string]json.RawMessage) {
		t.Helper()
		var b []byte
		if body != nil {
			b, _ = json.Marshal(body)
		}
		r, _ := http.NewRequest(method, httpServer.URL+path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-KHZ-Client", "studio")
		r.Header.Set("Origin", httpServer.URL)
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var data map[string]json.RawMessage
		_ = json.NewDecoder(response.Body).Decode(&data)
		return response, data
	}
	response, data := request(client, "POST", "/api/auth/register", authReq{Email: email, Password: password, DisplayName: "Тест ведучого"})
	if response.StatusCode != 200 || data["token"] != nil {
		t.Fatal("cookie signup failed or exposed bearer token")
	}
	var user store.User
	_ = json.Unmarshal(data["user"], &user)
	if user.ID == "" {
		t.Fatal("missing account")
	}
	defer db.Pool().Exec(context.Background(), `DELETE FROM users WHERE id=$1`, user.ID)
	var token string
	for _, cookie := range response.Cookies() {
		if cookie.Name == sessionCookie {
			if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
				t.Fatal("missing private session cookie flags")
			}
			token = cookie.Value
		}
	}
	if token == "" {
		t.Fatal("missing session cookie")
	}
	var digest string
	if err := db.Pool().QueryRow(ctx, `SELECT digest FROM auth_sessions WHERE user_id=$1`, user.ID).Scan(&digest); err != nil || digest == token {
		t.Fatal("raw session was stored")
	}
	response, _ = request(client, "GET", "/api/me", nil)
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("authenticated profile unavailable")
	}
	response, _ = request(client, "POST", "/api/auth/register", authReq{Email: email, Password: password, DisplayName: "Duplicate"})
	if response.StatusCode != 409 {
		t.Fatal("duplicate signup should conflict")
	}
	show := studioFixture().Session
	show.MatchID = "integration-show-key-123456789"
	show.Finished = true
	show.Round = 4
	show.History = []studioHistory{}
	for i := 1; i <= 4; i++ {
		show.History = append(show.History, studioHistory{Round: i, Team: "girls", Track: "Synthetic", Line: "Fixture", TrackID: 1})
	}
	for i := 0; i < 2; i++ {
		response, _ = request(client, "POST", "/api/me/shows", map[string]any{"session": show})
		if response.StatusCode != 200 {
			t.Fatal("finished show could not be saved")
		}
	}
	response, data = request(client, "GET", "/api/me/shows", nil)
	var shows []store.StudioMatch
	_ = json.Unmarshal(data["shows"], &shows)
	if response.StatusCode != 200 || len(shows) != 1 {
		t.Fatal("retry duplicated account history")
	}
	response, _ = request(&http.Client{}, "GET", "/api/me/shows", nil)
	if response.StatusCode != 401 {
		t.Fatal("guest received private account history")
	}
	response, _ = request(client, "POST", "/api/auth/logout", map[string]any{})
	if response.StatusCode != 200 {
		t.Fatal("logout failed")
	}
	replay, _ := http.NewRequest("GET", httpServer.URL+"/api/me", nil)
	replay.AddCookie(&http.Cookie{Name: sessionCookie, Value: token})
	res, err := http.DefaultClient.Do(replay)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("revoked session remained valid")
	}
	response, _ = request(client, "POST", "/api/auth/login", authReq{Email: email, Password: password})
	if response.StatusCode != 200 {
		t.Fatal("account could not sign in again")
	}
	bad, _ := http.NewRequest("POST", httpServer.URL+"/api/auth/logout", strings.NewReader(`{}`))
	bad.Header.Set("Origin", "https://another.example")
	res, err = client.Do(bad)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross-origin logout accepted")
	}
}
