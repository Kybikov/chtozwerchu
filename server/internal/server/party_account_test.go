package server

import (
	"bytes"
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPartyCookieIdentityAndIdempotentHistoryIntegration(t *testing.T) {
	dsn := os.Getenv("KHZ_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated Postgres required")
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
	catalog, _ := store.EmbeddedCatalog()
	h := NewHub(game.NewEngine(catalog), nil, db, "fixture-only")
	h.dir = t.TempDir()
	server := &Server{db: db}
	mux := http.NewServeMux()
	server.registerAuthRoutes(mux)
	mux.HandleFunc("/ws", h.ServeWS)
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	body, _ := json.Marshal(authReq{Email: fmt.Sprintf("party-integration-%d@example.invalid", time.Now().UnixNano()), Password: "integration-only-password", DisplayName: "Ведучий тесту"})
	response, err := client.Post(httpServer.URL+"/api/auth/register", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var account authResp
	_ = json.NewDecoder(response.Body).Decode(&account)
	response.Body.Close()
	if response.StatusCode != 200 || account.User == nil {
		t.Fatal("fixture signup failed")
	}
	defer db.Pool().Exec(context.Background(), `DELETE FROM users WHERE id=$1`, account.User.ID)
	request, _ := http.NewRequest("GET", httpServer.URL, nil)
	for _, c := range jar.Cookies(request.URL) {
		request.AddCookie(c)
	}
	request.Header.Set("Origin", httpServer.URL)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http")+"/ws", request.Header)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	send := func(kind string, payload any) {
		t.Helper()
		if conn.WriteJSON(map[string]any{"type": kind, "payload": payload}) != nil {
			t.Fatal("socket write failed")
		}
	}
	state := func() game.RoomView {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			var msg struct {
				Type    string `json:"type"`
				Message string `json:"message"`
				game.RoomView
			}
			if conn.ReadJSON(&msg) != nil {
				t.Fatal("state missing")
			}
			if msg.Type == "error" {
				t.Fatal(msg.Message)
			}
			if msg.Type == "state" {
				return msg.RoomView
			}
		}
	}
	send("create_room", map[string]any{"hostName": "Ведучий тесту", "rounds": 1, "roundTypes": []string{"five_words"}})
	lobby := state()
	if lobby.You == nil || !lobby.You.IsHost || !lobby.You.Registered {
		t.Fatal("cookie identity did not reach room")
	}
	room := h.session(lobby.Code)
	matchKey := room.room.MatchID
	defer db.Pool().Exec(context.Background(), `DELETE FROM matches WHERE id=$1`, "m-"+matchKey)
	send("start_game", nil)
	playing := state()
	if playing.Stage != game.StagePlaying {
		t.Fatal("game did not start")
	}
	send("action", map[string]any{"name": "reveal", "round": 1, "payload": map[string]any{"index": 0}})
	_ = state()
	send("action", map[string]any{"name": "force", "round": 1, "payload": map[string]any{"won": true}})
	result := state()
	if result.Result == nil || result.Result.Points != 4 {
		t.Fatal("score was not authoritative")
	}
	send("action", map[string]any{"name": "next", "round": 1})
	final := state()
	if final.Stage != game.StageFinal || len(final.History) != 1 {
		t.Fatal("final missing round history")
	}
	deadline := time.Now().Add(4 * time.Second)
	for {
		room.mu.Lock()
		saved := room.saved
		room.mu.Unlock()
		if saved {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("history save did not complete")
		}
		time.Sleep(30 * time.Millisecond)
	}
	room.mu.Lock()
	room.saved = false
	h.archiveParty(room)
	room.mu.Unlock()
	for {
		room.mu.Lock()
		saved := room.saved
		room.mu.Unlock()
		if saved {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("history retry did not complete")
		}
		time.Sleep(30 * time.Millisecond)
	}
	history, err := db.UserHistory(ctx, account.User.ID, 30)
	if err != nil || len(history) != 1 || history[0].Score != 4 {
		t.Fatal("history lost or duplicated match")
	}
}
