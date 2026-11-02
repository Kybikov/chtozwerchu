package game

import (
	"fmt"
	"testing"
	"time"
)

type playlistCatalog struct{ fakeCatalog }

func (playlistCatalog) Songs(string) []Song {
	return []Song{{ID: "a", Title: "А", Artist: "Гурт"}, {ID: "b", Title: "Б", Artist: "Гурт"}, {ID: "c", Title: "В", Artist: "Гурт"}}
}

func TestMelodyExhaustsPlaylistAcrossCyclesAndRestart(t *testing.T) {
	e := NewEngine(playlistCatalog{})
	r, _ := e.CreateRoom(CreateParams{Rounds: 6, RoundTypes: []RoundType{RoundMelody}})
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	for cycle := 0; cycle < 2; cycle++ {
		seen := map[string]bool{}
		for i := 0; i < 3; i++ {
			song := r.Current.Data.(*melodyData).Song
			if seen[song.ID] {
				t.Fatal("repeated a song before exhausting the playlist")
			}
			seen[song.ID] = true
			if err := e.Apply(r, Action{Name: "end_melody", IsHost: true}); err != nil {
				t.Fatal(err)
			}
			if r.Current.Result.ContentID != song.ID {
				t.Fatal("result lost content identity")
			}
			if err := e.Next(r); err != nil {
				t.Fatal(err)
			}
			if cycle == 0 && i == 1 {
				raw, _ := Snapshot(r)
				var err error
				r, err = RestoreSnapshot(raw)
				if err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if len(r.History) != 6 || r.Stage != StageFinal {
		t.Fatal("playlist history incomplete")
	}
}

func TestMelodyRetryRemainsPausedAndHostOnly(t *testing.T) {
	e, r := newTestRoom(t, RoundMelody)
	SetMelodyPreview(r, "")
	if _, ok := MelodyPreviewNeeded(r); ok {
		t.Fatal("unavailable preview retried on every broadcast")
	}
	if err := e.Apply(r, Action{Name: "retry_melody"}); err != ErrNotHost {
		t.Fatal("guest retried audio")
	}
	if err := e.Apply(r, Action{Name: "retry_melody", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	if _, ok := MelodyPreviewNeeded(r); !ok || !r.Paused || !r.Current.Deadline.IsZero() {
		t.Fatal("retry started the game clock")
	}
}

func TestRestoreRefreshesSignedPreviewWithoutStartingAnswerAudio(t *testing.T) {
	e, r, _, b := buzzerRoom(t)
	SetMelodyPreview(r, fmt.Sprintf("https://cdnt-preview.dzcdn.net/x?hdnea=exp=%d", time.Now().Add(-time.Minute).Unix()))
	_ = e.Apply(r, Action{Name: "resume", IsHost: true})
	_ = e.Apply(r, Action{Name: "buzz", Actor: b})
	e.Pause(r)
	left := r.Current.PausedRemaining
	listen := r.Current.Data.(*melodyData).Buzzer.ListenRemaining
	raw, _ := Snapshot(r)
	restored, err := RestoreSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	d := restored.Current.Data.(*melodyData)
	if d.Song.PreviewURL != "" || !restored.Paused || restored.Current.PausedRemaining != left || d.Buzzer.ListenRemaining != listen || d.Buzzer.Team != TeamBoys {
		t.Fatal("restore lost source freshness or buzzer clocks")
	}
	if _, ok := MelodyPreviewNeeded(restored); !ok {
		t.Fatal("restore cannot request fresh preview")
	}
	if restored.Media.Wanted || restored.Media.Playing {
		t.Fatal("restore started sound")
	}
}
