package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"chtozverchu/internal/game"
	"github.com/gorilla/websocket"
)

func TestBuzzerConcurrentSocketsAndAnswerResume(t *testing.T) {
	h := NewHub(game.NewEngine(mediaCatalog{}), nil, nil, "")
	h.dir = ""
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()
	var peers []*websocket.Conn
	defer func() {
		for _, p := range peers {
			p.Close()
		}
	}()
	dial := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
		if err != nil {
			t.Fatal(err)
		}
		peers = append(peers, c)
		return c
	}
	send := func(c *websocket.Conn, kind string, p any) {
		t.Helper()
		if err := c.WriteJSON(map[string]any{"type": kind, "payload": p}); err != nil {
			t.Fatal(err)
		}
	}
	read := func(c *websocket.Conn, test func(mediaWire) bool) mediaWire {
		t.Helper()
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		for {
			var m mediaWire
			if err := c.ReadJSON(&m); err != nil {
				t.Fatal(err)
			}
			if test(m) {
				return m
			}
		}
	}
	buzz := func(m mediaWire) map[string]any {
		r, _ := m.Round.(map[string]any)
		b, _ := r["buzzer"].(map[string]any)
		return b
	}
	host := dial()
	send(host, "create_room", map[string]any{"hostName": "Fixture", "protocol": 3, "rounds": 1, "roundTypes": []string{"melody"}, "melodyMode": "buzzer"})
	lobby := read(host, func(m mediaWire) bool { return m.Type == "state" })
	old := dial()
	send(old, "join", map[string]any{"code": lobby.Code, "name": "Old", "team": "boys", "protocol": 2})
	read(old, func(m mediaWire) bool { return m.Type == "error" })
	a, b := dial(), dial()
	for i, c := range []*websocket.Conn{a, b} {
		team := game.TeamGirls
		if i == 1 {
			team = game.TeamBoys
		}
		send(c, "join", map[string]any{"code": lobby.Code, "name": "Voter", "team": team, "protocol": 3})
		read(c, func(m mediaWire) bool { return m.Type == "state" })
	}
	send(host, "start_game", nil)
	scene := read(host, func(m mediaWire) bool { return m.Type == "state" && m.RoundIndex == 1 })
	send(host, "media_status", mediaStatus{Revision: scene.Media.Revision, Round: 1, Enabled: true, Ready: true, Duration: 30})
	read(host, func(m mediaWire) bool { return m.Type == "state" && m.Media.Ready })
	send(host, "action", map[string]any{"name": "resume", "round": 1})
	command := read(host, func(m mediaWire) bool { return m.Type == "state" && m.Media.Pending })
	send(host, "media_status", mediaStatus{Revision: command.Media.Revision, Round: 1, Enabled: true, Ready: true, Playing: true, Duration: 30, Position: 3})
	read(host, func(m mediaWire) bool { return m.Type == "state" && !m.Paused })
	errs := make(chan error, 2)
	for _, c := range []*websocket.Conn{a, b} {
		go func(peer *websocket.Conn) {
			errs <- peer.WriteJSON(map[string]any{"type": "action", "payload": map[string]any{"name": "buzz", "round": 1}})
		}(c)
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	claim := read(host, func(m mediaWire) bool { return m.Type == "state" && buzz(m)["phase"] == "answer" })
	team := game.Team(buzz(claim)["team"].(string))
	if !team.Valid() || buzz(claim)["attempt"] != float64(1) || claim.Media.Wanted || claim.Media.Playing || claim.Paused {
		t.Fatal("two concurrent signals did not produce one stopped-audio winner")
	}
	for _, c := range []*websocket.Conn{a, b} {
		v := read(c, func(m mediaWire) bool { return m.Type == "state" && buzz(m)["phase"] == "answer" })
		r := v.Round.(map[string]any)
		if r["hostAnswer"] != nil || r["song"] != nil {
			t.Fatal("claim leaked hidden music")
		}
	}
	send(host, "action", map[string]any{"name": "pause", "round": 1})
	read(host, func(m mediaWire) bool { return m.Type == "state" && m.Paused })
	send(host, "action", map[string]any{"name": "resume", "round": 1})
	resumed := read(host, func(m mediaWire) bool { return m.Type == "state" && !m.Paused && buzz(m)["phase"] == "answer" })
	if resumed.Media.Wanted || resumed.Media.Pending || resumed.DeadlineMs > time.Now().Add(11*time.Second).UnixMilli() {
		t.Fatal("answer resume restarted music or reset the answer clock")
	}
	send(host, "action", map[string]any{"name": "force", "round": 1, "payload": map[string]any{"won": true}})
	result := read(host, func(m mediaWire) bool { return m.Type == "state" && m.Stage == game.StageResult })
	if result.Result.Team != team || result.Teams[team].Score != 3 {
		t.Fatal("winner not awarded original listening points")
	}
}
