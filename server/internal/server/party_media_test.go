package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"chtozverchu/internal/game"
	"github.com/gorilla/websocket"
)

type mediaCatalog struct{}

func (mediaCatalog) Songs(string) []game.Song {
	return []game.Song{{ID: "media-fixture", Title: "Fixture", Artist: "Synthetic", PreviewURL: "https://example.invalid/fixture.mp3"}}
}
func (mediaCatalog) Statements(string) []game.Statement             { return nil }
func (mediaCatalog) AliasCards(string) []game.AliasCard             { return nil }
func (mediaCatalog) CrocodilePuzzles(string) []game.CrocodilePuzzle { return nil }

type mediaWire struct {
	Type    string `json:"type"`
	TVToken string `json:"tvToken"`
	game.RoomView
}

func TestPartyTVCapabilityAndAcknowledgedPlayback(t *testing.T) {
	h := NewHub(game.NewEngine(mediaCatalog{}), nil, nil, "")
	h.dir = t.TempDir()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	srv := httptest.NewServer(mux)
	defer srv.Close()
	peers := []*websocket.Conn{}
	dial := func() *websocket.Conn {
		t.Helper()
		c, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
		if e != nil {
			t.Fatal(e)
		}
		peers = append(peers, c)
		return c
	}
	defer func() {
		for _, c := range peers {
			// Acknowledge leave before removing the snapshot directory. Closing
			// the client socket alone does not wait for server-side persistence.
			_ = c.SetReadDeadline(time.Now().Add(2 * time.Second))
			if c.WriteJSON(map[string]any{"type": "leave"}) == nil && c.WriteJSON(map[string]any{"type": "ping"}) == nil {
				for {
					var m mediaWire
					if c.ReadJSON(&m) != nil || m.Type == "pong" {
						break
					}
				}
			}
			c.Close()
		}
	}()
	send := func(c *websocket.Conn, kind string, p any) {
		t.Helper()
		if c.WriteJSON(map[string]any{"type": kind, "payload": p}) != nil {
			t.Fatal("write failed")
		}
	}
	read := func(c *websocket.Conn, predicate func(mediaWire) bool) mediaWire {
		t.Helper()
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var m mediaWire
			if e := c.ReadJSON(&m); e != nil {
				t.Fatal(e)
			}
			if predicate(m) {
				return m
			}
		}
	}
	host := dial()
	send(host, "create_room", map[string]any{"hostName": "Fixture host", "protocol": 2, "rounds": 1, "roundTypes": []string{"melody"}})
	identity := read(host, func(m mediaWire) bool { return m.Type == "you_are" })
	if len(identity.TVToken) != 64 {
		t.Fatal("host did not receive a private TV capability")
	}
	lobby := read(host, func(m mediaWire) bool { return m.Type == "state" })
	code := lobby.Code
	room := h.session(code)
	defer func() {
		room.mu.Lock()
		if room.mediaTimer != nil {
			room.mediaTimer.Stop()
		}
		if room.timer != nil {
			room.timer.Stop()
		}
		room.mu.Unlock()
	}()
	public := dial()
	send(public, "watch", map[string]any{"code": code})
	pv := read(public, func(m mediaWire) bool { return m.Type == "state" })
	raw, _ := json.Marshal(pv)
	if strings.Contains(string(raw), identity.TVToken) {
		t.Fatal("public scene exposed TV capability")
	}
	invalid := dial()
	send(invalid, "watch", map[string]any{"code": code, "tv": true, "tvToken": "wrong"})
	_ = read(invalid, func(m mediaWire) bool { return m.Type == "error" })
	tv := dial()
	send(tv, "watch", map[string]any{"code": code, "tv": true, "tvToken": identity.TVToken})
	_ = read(tv, func(m mediaWire) bool { return m.Type == "state" })
	send(host, "action", map[string]any{"name": "audio_output", "payload": map[string]any{"output": "tv"}})
	send(host, "start_game", nil)
	scene := read(tv, func(m mediaWire) bool { return m.Type == "state" && m.RoundIndex == 1 })
	if !scene.Paused || scene.Media.Wanted {
		t.Fatal("timer started before sound")
	}
	send(tv, "media_status", mediaStatus{Revision: scene.Media.Revision, Round: 1, Ready: true, Duration: 30})
	disabled := read(host, func(m mediaWire) bool { return m.Type == "media_clock" })
	if disabled.Media.Ready || disabled.Media.Enabled || !scene.Paused {
		t.Fatal("audio became ready without authorization")
	}
	send(tv, "media_status", mediaStatus{Revision: scene.Media.Revision, Round: 1, Enabled: true, Ready: true, Duration: 30})
	ready := read(host, func(m mediaWire) bool { return m.Type == "state" && m.Media.Ready })
	send(tv, "action", map[string]any{"name": "force", "payload": map[string]any{"won": true}})
	_ = read(tv, func(m mediaWire) bool { return m.Type == "error" })
	send(host, "action", map[string]any{"name": "resume", "round": 1})
	command := read(tv, func(m mediaWire) bool { return m.Type == "state" && m.Media.Pending })
	if !command.Paused || command.DeadlineMs != 0 {
		t.Fatal("click started the timer without an audio acknowledgement")
	}
	send(tv, "media_status", mediaStatus{Revision: command.Media.Revision, Round: 1, Enabled: true, Ready: true, Playing: true, Duration: 30, Position: .1})
	playing := read(host, func(m mediaWire) bool { return m.Type == "state" && !m.Paused && m.Media.Playing })
	if playing.DeadlineMs <= time.Now().UnixMilli() || playing.Teams[game.TeamGirls].Score != 0 {
		t.Fatal("audio start affected scoring or lost timer")
	}
	send(host, "action", map[string]any{"name": "audio_volume", "round": 1, "payload": map[string]any{"volume": 0}})
	_ = read(tv, func(m mediaWire) bool { return m.Type == "state" && m.Media.Volume == 0 })
	tv.Close()
	paused := read(host, func(m mediaWire) bool { return m.Type == "state" && m.Paused && !m.Media.TVConnected })
	if paused.Media.Wanted || paused.Media.Playing {
		t.Fatal("disconnected TV left audio running")
	}
	if ready.Media.Output != "tv" {
		t.Fatal("selected output changed")
	}
}
