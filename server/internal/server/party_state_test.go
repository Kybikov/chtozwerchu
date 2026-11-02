package server

import (
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
	"testing"
)

func TestPartyRoomSurvivesRestartWithPrivateCapabilities(t *testing.T) {
	catalog, err := store.EmbeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	engine := game.NewEngine(catalog)
	h := NewHub(engine, nil, nil, "")
	h.dir = t.TempDir()
	r, p := engine.CreateRoom(game.CreateParams{HostName: "Ведучий", Rounds: 5, RoundTypes: []game.RoundType{game.RoundAlias}})
	if err := engine.StartGame(r); err != nil {
		t.Fatal(err)
	}
	if err := engine.Apply(r, game.Action{Name: "correct", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	s := &RoomSession{room: r, clients: map[*Client]bool{}}
	h.persist(s)
	h2 := NewHub(engine, nil, nil, "")
	h2.dir = h.dir
	h2.restoreParty()
	recovered := h2.session(r.Code)
	if recovered == nil || !recovered.room.Paused || recovered.room.Players[0].Token != p.Token {
		t.Fatal("private state or host access was lost")
	}
	view := game.BuildView(recovered.room, nil)
	if round := view.Round.(map[string]any); round["current"] != nil || round["scored"] != 1 {
		t.Fatal("restored scene exposed card or lost score")
	}
}
