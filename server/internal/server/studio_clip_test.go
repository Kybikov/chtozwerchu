package server

import (
	"encoding/json"
	"testing"
	"time"
)

func TestStudioStartsTheChosenExcerptAndKeepsLegacySevenSeconds(t *testing.T) {
	for _, tc := range []struct {
		seconds int
		start   float64
	}{{0, 13}, {5, 15}, {7, 13}, {10, 10}, {15, 5}} {
		s := studioFixture()
		s.Session.Offset = -17000 // The hidden answer is at audio second 20.
		s.Session.LeadInSeconds = tc.seconds
		s.Audio.Duration = 30
		if err := validateStudio(s.Session, s.Track, s.Audio); err != nil {
			t.Fatal(err)
		}
		ins, err := s.apply(studioAction{Type: "start"}, time.Now(), true)
		if err != nil || ins.Position != tc.start || s.Audio.Position != tc.start || s.stopAt() != 20 {
			t.Fatalf("excerpt %d moved its start or cutoff: %v %v", tc.seconds, ins, err)
		}
	}
}

func TestStudioClipChangesOnlyInPreparationAndSurvivesSnapshots(t *testing.T) {
	s := studioFixture()
	before := s.Version
	if _, err := s.apply(studioAction{Type: "clip", Index: 6}, time.Now(), true); err == nil || s.Version != before {
		t.Fatal("invalid clip length mutated room")
	}
	ins, err := s.apply(studioAction{Type: "clip", Index: 15}, time.Now(), true)
	if err != nil || ins.Type != "pause" || s.Session.LeadInSeconds != 15 || s.Phase != "ready" || s.Session.Scores["girls"] != 0 {
		t.Fatal("clip editing started or scored a round")
	}
	raw, _ := json.Marshal(s)
	var restored studioState
	if json.Unmarshal(raw, &restored) != nil || restored.Session.LeadInSeconds != 15 {
		t.Fatal("snapshot lost the chosen excerpt")
	}
	s.Phase = "playing"
	if _, err := s.apply(studioAction{Type: "clip", Index: 5}, time.Now(), true); err == nil || s.Session.LeadInSeconds != 15 {
		t.Fatal("active round allowed clip changes")
	}
	for _, bad := range []int{-1, 6, 20, 100} {
		s.Session.LeadInSeconds = bad
		if validateStudio(s.Session, s.Track, s.Audio) == nil {
			t.Fatal("invalid persisted clip accepted")
		}
	}
}
