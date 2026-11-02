package server

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestStudioPublishesExactCurrentWordTimelineAndHidesFutureWords(t *testing.T) {
	s := studioFixture()
	words := []musicWord{{StartMS: 53, EndMS: 350, Text: "Лови "}, {StartMS: 700, EndMS: 1020, Text: "цей "}, {StartMS: 1100, EndMS: 1350, Text: "ритм"}}
	s.Track.Cues[0].Text = "Лови цей ритм"
	s.Track.Cues[0].Words = words
	s.Track.Cues[1].Words = []musicWord{{StartMS: 3001, EndMS: 3100, Text: "Future secret"}}
	if err := validateStudioTrack(s.Track); err != nil {
		t.Fatal(err)
	}
	s.Phase = "playing"
	s.Audio.Position = .5
	s.Session.Offset = 250
	r := &studioRoom{State: s}
	view := r.public(time.Now())
	if view["nowMS"] != float64(750) || !reflect.DeepEqual(view["words"], words) {
		t.Fatal("projection changed captured boundaries or audio offset")
	}
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "Future secret") || strings.Contains(string(raw), "Hidden answer") {
		t.Fatal("projection exposed future lyric words")
	}
	for _, phase := range []string{"ready", "answer", "result", "final"} {
		r.State.Phase = phase
		if view := r.public(time.Now()); view["words"] != nil || view["lyric"] != "" {
			t.Fatalf("word timeline exposed in %s", phase)
		}
	}
	s.Track.Cues[0].Words[1].StartMS = 300
	if validateStudioTrack(s.Track) == nil {
		t.Fatal("overlapping word timings accepted")
	}
}
