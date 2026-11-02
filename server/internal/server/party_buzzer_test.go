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

func TestBuzzerAnswerDeadlineReplacesListeningTimer(t *testing.T) {
	e := game.NewEngine(mediaCatalog{})
	h := NewHub(e, nil, nil, "")
	h.dir = ""
	r, host := e.CreateRoom(game.CreateParams{Rounds: 1, RoundTypes: []game.RoundType{game.RoundMelody}, MelodyMode: "buzzer"})
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	_ = e.Apply(r, game.Action{Name: "resume", IsHost: true})
	c := &Client{player: host, send: make(chan []byte, 8)}
	s := &RoomSession{room: r, clients: map[*Client]bool{c: true}}
	s.mu.Lock()
	h.armTimer(s)
	listeningDeadline := r.Current.Deadline
	if err := e.Apply(r, game.Action{Name: "buzz", IsHost: true, Payload: map[string]any{"team": "girls"}}); err != nil {
		t.Fatal(err)
	}
	// Shorten only this fixture's answer window; the real window is tested by
	// the engine and browser. Waiting on a broadcast proves the Hub timer ran.
	r.Current.Deadline = time.Now().Add(50 * time.Millisecond)
	h.armTimer(s)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.timer != nil {
			s.timer.Stop()
		}
		if s.mediaTimer != nil {
			s.mediaTimer.Stop()
		}
	}()
	h.fireTimeout(s, r.RoundIndex, listeningDeadline)
	select {
	case raw := <-c.send:
		var m mediaWire
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		round := m.Round.(map[string]any)
		if !m.Paused || round["buzzer"].(map[string]any)["phase"] != "handoff" || m.RemainingMs < 35000 {
			t.Fatal("answer timeout lost the other team's listening window")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the old listening timer prevented the answer deadline from firing")
	}
}

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
