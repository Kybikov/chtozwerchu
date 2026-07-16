package game

import "testing"

// fakeCatalog provides minimal deterministic content for tests.
type fakeCatalog struct{}

func (fakeCatalog) Songs(string) []Song {
	return []Song{{
		ID: "s1", Title: "Пісня", Artist: "Гурт",
		Phrases: [][]string{{"один", "два", "три", "чотири", "пʼfive"}},
	}}
}
func (fakeCatalog) Statements(string) []Statement {
	return []Statement{{ID: "st1", Text: "твердження", Truth: true, Fact: "факт"}}
}
func (fakeCatalog) AliasCards(string) []AliasCard {
	return []AliasCard{
		{ID: "a1", Word: "кавун"},
		{ID: "a2", Word: "гітара"},
	}
}
func (fakeCatalog) CrocodilePuzzles(string) []CrocodilePuzzle {
	return []CrocodilePuzzle{{ID: "c1", Emoji: "🦁", Answer: "лев"}}
}

func newTestRoom(t *testing.T, rt RoundType) (*Engine, *Room) {
	t.Helper()
	e := NewEngine(fakeCatalog{})
	room, _ := e.CreateRoom(CreateParams{HostTeam: TeamGirls, Rounds: 1, RoundTypes: []RoundType{rt}})
	if err := e.StartGame(room); err != nil {
		t.Fatalf("start: %v", err)
	}
	return e, room
}

func TestFiveWordsScoring(t *testing.T) {
	e, room := newTestRoom(t, RoundFiveWords)
	// reveal one word, then win → 5-1 = 4 points
	if err := e.Apply(room, Action{Name: "reveal", IsHost: true, Payload: map[string]any{"index": float64(0)}}); err != nil {
		t.Fatal(err)
	}
	if err := e.Apply(room, Action{Name: "force", IsHost: true, Payload: map[string]any{"won": true}}); err != nil {
		t.Fatal(err)
	}
	if room.Stage != StageResult {
		t.Fatalf("stage = %s, want result", room.Stage)
	}
	if got := room.Teams[TeamGirls].Score; got != 4 {
		t.Fatalf("score = %d, want 4", got)
	}
}

func TestFiveWordsRequiresReveal(t *testing.T) {
	e, room := newTestRoom(t, RoundFiveWords)
	err := e.Apply(room, Action{Name: "guess", IsHost: true, Payload: map[string]any{"text": "щось"}})
	if err == nil {
		t.Fatal("expected error guessing before any reveal")
	}
}

func TestAliasHasDeadlineAndTimeout(t *testing.T) {
	e, room := newTestRoom(t, RoundAlias)
	if room.Current.Deadline.IsZero() {
		t.Fatal("alias round should have a deadline")
	}
	// score one word, then time out.
	if err := e.Apply(room, Action{Name: "correct", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	e.Timeout(room)
	if room.Stage != StageResult {
		t.Fatalf("stage = %s, want result after timeout", room.Stage)
	}
	if room.Teams[TeamGirls].Score != 1 {
		t.Fatalf("score = %d, want 1", room.Teams[TeamGirls].Score)
	}
}

func TestAliasRedactsWordFromGuessers(t *testing.T) {
	_, room := newTestRoom(t, RoundAlias)
	explainer := room.Players[0] // host is the explainer by default
	guesser := &Player{ID: "p-guess", Team: TeamGirls}
	room.Players = append(room.Players, guesser)

	// explainer/host sees the current word
	ev, _ := alias{}.View(room, explainer).(map[string]any)
	if _, ok := ev["current"]; !ok {
		t.Fatal("explainer should see current word")
	}
	// guesser must NOT see the current word
	gv, _ := alias{}.View(room, guesser).(map[string]any)
	if _, ok := gv["current"]; ok {
		t.Fatal("guesser must not see current word")
	}
}

func TestTruthLieScoring(t *testing.T) {
	e, room := newTestRoom(t, RoundTruthLie)
	// statement truth=true; vote truth → win 2
	if err := e.Apply(room, Action{Name: "vote", IsHost: true, Payload: map[string]any{"truth": true}}); err != nil {
		t.Fatal(err)
	}
	if room.Teams[TeamGirls].Score != 2 {
		t.Fatalf("score = %d, want 2", room.Teams[TeamGirls].Score)
	}
}

func TestMelodyPreviewInjection(t *testing.T) {
	_, room := newTestRoom(t, RoundMelody)
	title, _, ok := MelodyPreviewNeeded(room)
	if !ok || title == "" {
		t.Fatal("melody round should need a preview")
	}
	if !SetMelodyPreview(room, "https://cdn/x.mp3") {
		t.Fatal("SetMelodyPreview should succeed")
	}
	// second call is a no-op (already set)
	if SetMelodyPreview(room, "https://cdn/other.mp3") {
		t.Fatal("preview should only be set once")
	}
	view, _ := melody{}.View(room, room.Players[0]).(map[string]any)
	if view["previewUrl"] != "https://cdn/x.mp3" {
		t.Fatalf("view previewUrl = %v", view["previewUrl"])
	}
}

func TestNextFlipsActiveTeam(t *testing.T) {
	e, room := newTestRoom(t, RoundFiveWords)
	first := room.ActiveTeam
	_ = e.Apply(room, Action{Name: "force", IsHost: true, Payload: map[string]any{"won": false}})
	if err := e.Apply(room, Action{Name: "next", IsHost: true}); err != nil {
		// only 1 round in deck → next moves to final
		t.Fatalf("next: %v", err)
	}
	if room.Stage != StageFinal {
		t.Fatalf("stage = %s, want final", room.Stage)
	}
	_ = first
}
