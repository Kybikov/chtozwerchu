package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func studioFixture() studioState {
	cues := []musicCue{}
	for i, ms := range []int64{0, 3000, 6000, 9000, 10500} {
		cues = append(cues, musicCue{StartMS: ms, EndMS: ms + 1400, Text: []string{"Opening", "Hidden answer one", "Hidden answer two", "Hidden answer three", "Hidden answer four"}[i]})
	}
	return studioState{Session: studioSession{Scores: map[string]int{"girls": 0, "boys": 0}, Names: map[string]string{"girls": "Дівчата", "boys": "Хлопці"}, Team: "girls", Round: 1, Rounds: 4, TrackID: 1, Target: 1, AnswerSeconds: 20, Aligned: true, History: []studioHistory{}}, Track: musicTrack{ID: 1, Title: "Synthetic", Artist: "Fixture", Duration: 12, Cues: cues}, Audio: studioAudio{Duration: 12, Ready: true, Local: true, Volume: 65}, Phase: "ready", Version: 1}
}
func TestStudioAuthoritativeMatchAndUndo(t *testing.T) {
	s := studioFixture()
	now := time.Unix(100, 0)
	girls, boys := "girls", "boys"
	for round := 1; round <= 4; round++ {
		ins, err := s.apply(studioAction{Type: "start", ID: "start-request"}, now, true)
		if err != nil || ins.Type != "start" {
			t.Fatal("valid round did not start", err)
		}
		if _, err = s.apply(studioAction{Type: "award", Team: &girls}, now, true); err == nil {
			t.Fatal("award accepted before answer phase")
		}
		s.answer(now)
		team := &girls
		if round%2 == 0 {
			team = &boys
		}
		if round == 4 {
			team = nil
		}
		if _, err = s.apply(studioAction{Type: "award", Team: team}, now, true); err != nil {
			t.Fatal(err)
		}
		if _, err = s.apply(studioAction{Type: "award", Team: team}, now, true); err == nil {
			t.Fatal("duplicate award accepted")
		}
		if round == 2 {
			if _, err = s.apply(studioAction{Type: "undo"}, now, true); err != nil {
				t.Fatal(err)
			}
			if s.Session.Scores[boys] != 0 || len(s.Session.History) != 1 {
				t.Fatal("undo did not restore current award")
			}
			_, err = s.apply(studioAction{Type: "award", Team: &boys}, now, true)
			if err != nil {
				t.Fatal(err)
			}
		}
		if _, err = s.apply(studioAction{Type: "next"}, now, true); err != nil {
			t.Fatal(err)
		}
	}
	if s.Phase != "final" || !s.Session.Finished || s.Session.Scores[girls] != 6 || s.Session.Scores[boys] != 3 || len(s.Session.History) != 4 {
		t.Fatal("incorrect final standings")
	}
	_, err := s.apply(studioAction{Type: "new_game"}, now, true)
	if err != nil || s.Phase != "ready" || s.Session.Finished || s.Session.Round != 1 || len(s.Session.History) != 0 || s.Session.Scores[girls] != 0 {
		t.Fatal("new game did not reset the match")
	}
}
func TestStudioTimerUsesServerDeadlineAndPauses(t *testing.T) {
	s := studioFixture()
	now := time.Unix(100, 0)
	s.answer(now)
	if s.left(now.Add(7*time.Second)) != 13000 {
		t.Fatal("wrong server clock")
	}
	_, err := s.apply(studioAction{Type: "timer_toggle"}, now.Add(7*time.Second), true)
	if err != nil {
		t.Fatal(err)
	}
	if s.left(now.Add(time.Hour)) != 13000 {
		t.Fatal("paused answer clock advanced")
	}
	_, err = s.apply(studioAction{Type: "timer_toggle"}, now.Add(time.Hour), true)
	if err != nil || s.left(now.Add(time.Hour+3*time.Second)) != 10000 {
		t.Fatal("resume lost the remaining time")
	}
	s.pause(now.Add(time.Hour + 4*time.Second))
	if s.left(now.Add(2*time.Hour)) != 9000 {
		t.Fatal("disconnect did not preserve remaining time")
	}
}
func TestStudioPublicProjectionNeverContainsUpcomingAnswer(t *testing.T) {
	s := studioFixture()
	r := studioRoom{State: s}
	r.State.Phase = "playing"
	r.State.Audio.Position = 3.1
	for _, phase := range []string{"ready", "playing", "answer"} {
		r.State.Phase = phase
		b, _ := json.Marshal(r.public(time.Now()))
		if bytes.Contains(b, []byte("Hidden answer")) || bytes.Contains(b, []byte(`"cues"`)) || bytes.Contains(b, []byte(`"history"`)) || bytes.Contains(b, []byte(`"target"`)) {
			t.Fatalf("private data leaked in %s", phase)
		}
	}
	r.State.answer(time.Now())
	team := "girls"
	_, _ = r.State.apply(studioAction{Type: "award", Team: &team}, time.Now(), true)
	b, _ := json.Marshal(r.public(time.Now()))
	if !bytes.Contains(b, []byte("Hidden answer one")) {
		t.Fatal("answer was not revealed after adjudication")
	}
}
func TestStudioRequiresReadyMediaAndReachableTarget(t *testing.T) {
	s := studioFixture()
	if _, err := s.apply(studioAction{Type: "start"}, time.Now(), false); err == nil {
		t.Fatal("started without a ready station")
	}
	s.Session.Target = 0
	if _, err := s.apply(studioAction{Type: "start"}, time.Now(), true); err == nil {
		t.Fatal("started at invalid zero-time target")
	}
	s.Session.Target = 4
	s.Audio.Duration = 9
	if _, err := s.apply(studioAction{Type: "start"}, time.Now(), true); err == nil {
		t.Fatal("started beyond audio duration")
	}
}

func TestStudioSnapshotRestoresGameAndPausesPlayback(t *testing.T) {
	dir := t.TempDir()
	h := newStudioHub(dir)
	s := studioFixture()
	s.Phase = "playing"
	s.Audio.Playing = true
	r := &studioRoom{Code: "ABC234", State: s, Expires: time.Now().Add(time.Hour).UnixMilli()}
	if err := h.save(r); err != nil {
		t.Fatal(err)
	}
	h.close()
	restored := newStudioHub(dir)
	defer restored.close()
	room := restored.get(r.Code)
	if room == nil {
		t.Fatal("snapshot was not recovered")
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.State.Phase != "playing" || room.State.Audio.Playing || room.State.Audio.Ready || room.State.Version <= s.Version {
		t.Fatal("recovery did not freeze playback")
	}
}

type studioTestAccess struct {
	Code         string `json:"code"`
	StationToken string `json:"stationToken"`
	HostToken    string `json:"hostToken"`
}

func newStudioTestServer(t *testing.T) (*studioHub, *httptest.Server, studioTestAccess) {
	t.Helper()
	h := newStudioHub("")
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/studio/rooms", h.create)
	mux.HandleFunc("GET /api/studio/ws", h.connect)
	server := httptest.NewServer(mux)
	t.Cleanup(func() { h.close(); server.Close() })
	s := studioFixture()
	body, _ := json.Marshal(map[string]any{"session": s.Session, "track": s.Track, "audio": s.Audio, "effects": true})
	res, err := http.Post(server.URL+"/api/studio/rooms", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var access studioTestAccess
	if res.StatusCode != 201 || json.NewDecoder(res.Body).Decode(&access) != nil {
		t.Fatal("could not create fixture room")
	}
	return h, server, access
}
func studioDial(t *testing.T, serverURL, code, role, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(serverURL, "http")+"/api/studio/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	if conn.WriteJSON(map[string]string{"type": "auth", "code": code, "role": role, "token": token}) != nil {
		t.Fatal("auth write failed")
	}
	return conn
}
func studioRead(t *testing.T, c *websocket.Conn, kind string) map[string]json.RawMessage {
	t.Helper()
	for i := 0; i < 60; i++ {
		_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
		var m map[string]json.RawMessage
		if err := c.ReadJSON(&m); err != nil {
			t.Fatal("expected room response", err)
		}
		var typ string
		_ = json.Unmarshal(m["type"], &typ)
		if typ == kind {
			return m
		}
	}
	t.Fatal("response not received")
	return nil
}
func TestStudioWebSocketRolesAndRevisionGuards(t *testing.T) {
	_, server, access := newStudioTestServer(t)
	invalid := studioDial(t, server.URL, access.Code, "host", "wrong-token")
	studioRead(t, invalid, "fatal")
	audience := studioDial(t, server.URL, access.Code, "audience", "")
	scene := studioRead(t, audience, "scene")
	if bytes.Contains(scene["state"], []byte("Hidden answer")) {
		t.Fatal("audience received secret lyrics")
	}
	_ = audience.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "new_game", ID: "viewer-forgery", Version: 1}})
	studioRead(t, audience, "error")
	station := studioDial(t, server.URL, access.Code, "station", access.StationToken)
	studioRead(t, station, "state")
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Duration: 12, Volume: 65}})
	studioRead(t, station, "clock")
	host := studioDial(t, server.URL, access.Code, "host", access.HostToken)
	m := studioRead(t, host, "state")
	var state studioState
	_ = json.Unmarshal(m["state"], &state)
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "start", ID: "start-command", Version: state.Version}})
	m = studioRead(t, host, "state")
	_ = json.Unmarshal(m["state"], &state)
	if state.Phase != "playing" {
		t.Fatal("host start was not authoritative")
	}
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "answer", ID: "stale-command", Version: state.Version - 1}})
	studioRead(t, host, "error")
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Duration: 12, Position: 3.01, Volume: 65}})
	for i := 0; i < 10; i++ {
		m = studioRead(t, host, "state")
		_ = json.Unmarshal(m["state"], &state)
		if state.Phase == "answer" {
			break
		}
	}
	if state.Phase != "answer" {
		t.Fatal("audio crossing did not end fragment")
	}
	team := "girls"
	a := studioEnvelope{Type: "action", Action: studioAction{Type: "award", ID: "award-command", Version: state.Version, Team: &team}}
	_ = host.WriteJSON(a)
	m = studioRead(t, host, "state")
	_ = json.Unmarshal(m["state"], &state)
	_ = host.WriteJSON(a)
	m = studioRead(t, host, "state")
	_ = json.Unmarshal(m["state"], &state)
	if state.Session.Scores[team] != 3 || len(state.Session.History) != 1 {
		t.Fatal("network retry duplicated an award")
	}
}
func TestStudioRejectsCrossOriginWebSocket(t *testing.T) {
	_, server, _ := newStudioTestServer(t)
	headers := http.Header{"Origin": []string{"https://unrelated.example"}}
	conn, res, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/api/studio/ws", headers)
	if conn != nil {
		conn.Close()
	}
	if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatal("cross-origin connection accepted")
	}
}

func TestStudioMuteInstructionPreservesZeroOnWire(t *testing.T) {
	s := studioFixture()
	instruction, err := s.apply(studioAction{Type: "volume", Index: 0, ID: "mute-command"}, time.Now(), true)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(instruction)
	if !bytes.Contains(b, []byte(`"position":0`)) {
		t.Fatal("mute instruction omitted zero volume")
	}
}

func TestStudioStationDisconnectPausesAnswerClock(t *testing.T) {
	h, server, access := newStudioTestServer(t)
	station := studioDial(t, server.URL, access.Code, "station", access.StationToken)
	studioRead(t, station, "state")
	room := h.get(access.Code)
	room.mu.Lock()
	room.State.answer(time.Now())
	room.State.Version++
	room.mu.Unlock()
	host := studioDial(t, server.URL, access.Code, "host", access.HostToken)
	studioRead(t, host, "state")
	station.Close()
	var state studioState
	for i := 0; i < 8; i++ {
		m := studioRead(t, host, "state")
		_ = json.Unmarshal(m["state"], &state)
		if state.Timer.Paused {
			break
		}
	}
	if !state.Timer.Paused || state.Audio.Ready || state.Timer.LeftMS <= 0 {
		t.Fatal("station disconnect did not safely pause the question")
	}
}
