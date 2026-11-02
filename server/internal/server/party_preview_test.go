package server

import (
	"testing"

	"chtozverchu/internal/game"
)

type lookupCatalog struct{ mediaCatalog }

func (lookupCatalog) Songs(string) []game.Song {
	return []game.Song{{ID: "lookup-fixture", Title: "Private title", Artist: "Private artist"}}
}

func TestDelayedPreviewCannotReplaceFirstRoundOfNewMatch(t *testing.T) {
	e := game.NewEngine(lookupCatalog{})
	h := NewHub(e, nil, nil, "")
	r, _ := e.CreateRoom(game.CreateParams{Rounds: 1, RoundTypes: []game.RoundType{game.RoundMelody}})
	s := &RoomSession{room: r, clients: map[*Client]bool{}}
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	old := h.previewRequest(s)
	if old == nil || h.previewRequest(s) != nil {
		t.Fatal("duplicate in-flight request")
	}
	_ = e.Apply(r, game.Action{Name: "finish", IsHost: true})
	_ = e.ToLobby(r)
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	current := h.previewRequest(s)
	if current == nil || current.round == old.round {
		t.Fatal("new match did not receive its own lookup")
	}
	h.completePreview(s, old, "https://example.invalid/old.mp3")
	if _, needed := game.MelodyPreviewNeeded(r); !needed || s.previewRound != current.round {
		t.Fatal("stale response changed new match or cleared its lookup")
	}
	h.completePreview(s, current, "")
	if err := e.Apply(r, game.Action{Name: "retry_melody", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	retry := h.previewRequest(s)
	if retry == nil {
		t.Fatal("unavailable lookup could not be retried")
	}
	h.completePreview(s, retry, "https://example.invalid/current.mp3")
	view := game.BuildView(r, nil).Round.(map[string]any)
	if view["previewUrl"] != "https://example.invalid/current.mp3" || view["hostAnswer"] != nil || !r.Paused {
		t.Fatal("retry lost source, privacy, or paused state")
	}
}
