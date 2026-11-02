package server

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func programmeFixture() studioState {
	s := studioFixture()
	s.Session.Programme = &studioProgramme{Title: "Our original fixture evening", TrackIDs: []int64{1, 3, 2, 4}}
	for _, id := range []int64{1, 2, 3, 4} {
		s.Library = append(s.Library, studioPrepared{ID: id, Title: "Unplayed private title", Duration: 12, Local: true})
	}
	return s
}

func TestStudioProgrammeKeepsOrderAndExactlyOneScorePerRound(t *testing.T) {
	s := programmeFixture()
	now := time.Now()
	girls := "girls"
	for round := 1; round <= 4; round++ {
		if _, err := s.apply(studioAction{Type: "start"}, now, true); err != nil {
			t.Fatal(err)
		}
		s.answer(now)
		if _, err := s.apply(studioAction{Type: "award", Team: &girls}, now, true); err != nil {
			t.Fatal(err)
		}
		before := s.Session.Scores[girls]
		ins, err := s.apply(studioAction{Type: "next"}, now, true)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.apply(studioAction{Type: "next"}, now, true); err == nil {
			t.Fatal("repeated next skipped a song")
		}
		if s.Session.Scores[girls] != before {
			t.Fatal("next changed awarded points")
		}
		if round == 4 {
			if s.Phase != "final" || !s.Session.Finished {
				t.Fatal("programme did not finish")
			}
			break
		}
		id := s.Session.Programme.TrackIDs[round]
		if ins == nil || ins.Type != "load_track" || !ins.Prepared || ins.TrackID != id || !s.NeedsTrack || s.Audio.Ready || s.Audio.Playing || s.Session.Aligned {
			t.Fatal("next did not prepare the exact following source on pause")
		}
		if _, err = s.apply(studioAction{Type: "start"}, now, true); err == nil {
			t.Fatal("old audio started the new round")
		}
		// Model the station's successful prepare response.
		s.Track.ID = id
		s.Session.TrackID = id
		s.Session.Aligned = true
		s.Audio.Ready = true
		s.NeedsTrack = false
	}
	if len(s.Session.History) != 4 || s.Session.Scores[girls] != 12 {
		t.Fatal("programme result was incomplete")
	}
}

func TestStudioProgrammeCannotAdvanceWithoutStationOrSavedSource(t *testing.T) {
	s := programmeFixture()
	now := time.Now()
	s.answer(now)
	if _, err := s.apply(studioAction{Type: "award"}, now, true); err != nil {
		t.Fatal(err)
	}
	original, _ := json.Marshal(s)
	if _, err := s.apply(studioAction{Type: "next"}, now, false); err == nil {
		t.Fatal("advanced without station")
	}
	unchanged, _ := json.Marshal(s)
	if !bytes.Equal(original, unchanged) {
		t.Fatal("offline next changed canonical state")
	}
	s.Library = nil
	original, _ = json.Marshal(s)
	if _, err := s.apply(studioAction{Type: "next"}, now, true); err == nil {
		t.Fatal("advanced without the saved preparation")
	}
	unchanged, _ = json.Marshal(s)
	if !bytes.Equal(original, unchanged) {
		t.Fatal("missing song changed current round or score")
	}
	if _, err := s.apply(studioAction{Type: "manual_programme"}, now, true); err != nil {
		t.Fatal("host cannot recover with manual selection", err)
	}
	if s.Session.Programme != nil {
		t.Fatal("manual mode retained queue")
	}
	if _, err := s.apply(studioAction{Type: "next"}, now, true); err != nil {
		t.Fatal("manual recovery did not advance", err)
	}
}

func TestStudioProgrammeProjectionAndRestoration(t *testing.T) {
	s := programmeFixture()
	if err := validateStudio(s.Session, s.Track, s.Audio); err != nil {
		t.Fatal(err)
	}
	r := studioRoom{State: s}
	b, _ := json.Marshal(r.public(time.Now()))
	for _, secret := range []string{"trackIds", "Unplayed private title", "Hidden answer"} {
		if bytes.Contains(b, []byte(secret)) {
			t.Fatal("future programme data leaked to viewers")
		}
	}
	if !bytes.Contains(b, []byte(s.Session.Programme.Title)) {
		t.Fatal("public event title missing")
	}
	dir := t.TempDir()
	h := newStudioHub(dir)
	room := &studioRoom{Code: "PRG234", State: s, Expires: time.Now().Add(time.Hour).UnixMilli()}
	room.State.NeedsTrack = true
	room.State.Session.Round = 2
	room.State.Session.Aligned = false
	if err := h.save(room); err != nil {
		t.Fatal(err)
	}
	h.close()
	restored := newStudioHub(dir)
	defer restored.close()
	loaded := restored.get(room.Code)
	if loaded == nil || loaded.State.Session.Programme == nil || loaded.State.Session.Programme.TrackIDs[1] != 3 || !loaded.State.NeedsTrack || loaded.State.Audio.Playing || loaded.State.Audio.Ready {
		t.Fatal("pending programme did not recover paused")
	}
}

func TestStudioProgrammeRejectsMalformedOrderAndChangedRoundCount(t *testing.T) {
	for _, p := range []*studioProgramme{{Title: "", TrackIDs: []int64{1, 2, 3, 4}}, {Title: "Bad", TrackIDs: []int64{1, 1, 3, 4}}, {Title: "Bad", TrackIDs: []int64{1, 2}}, {Title: "Bad", TrackIDs: []int64{0, 2, 3, 4}}} {
		s := studioFixture()
		s.Session.Programme = p
		if validateStudio(s.Session, s.Track, s.Audio) == nil {
			t.Fatal("invalid programme accepted")
		}
	}
	s := programmeFixture()
	now := time.Now()
	_, err := s.apply(studioAction{Type: "config", Config: &studioConfig{Rounds: 8, AnswerSeconds: 20, Names: s.Session.Names}}, now, true)
	if err == nil || s.Session.Rounds != 4 {
		t.Fatal("settings changed programme length")
	}
	_, err = s.apply(studioAction{Type: "load_track", TrackID: 9}, now, true)
	if err != nil || s.Session.Programme != nil {
		t.Fatal("manual recording selection did not leave programme")
	}
}

func TestStudioProgrammeTelemetryCannotRearmPreviousRecording(t *testing.T) {
	h, srv, access := newStudioTestServer(t)
	r := h.get(access.Code)
	r.mu.Lock()
	r.State.Session.Programme = &studioProgramme{Title: "Telemetry race fixture", TrackIDs: []int64{1, 2, 3, 4}}
	r.State.NeedsTrack = true
	r.State.Session.Aligned = false
	r.State.Audio.Ready = false
	r.mu.Unlock()
	station := studioDial(t, srv.URL, access.Code, "station", access.StationToken)
	studioRead(t, station, "state")
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Playing: true, Duration: 12, Volume: 65}})
	m := studioRead(t, station, "clock")
	var audio studioAudio
	if json.Unmarshal(m["audio"], &audio) != nil || audio.Ready || audio.Playing {
		t.Fatal("previous recording rearmed a pending programme")
	}
}
