package game

import (
	"fmt"
	"time"
)

// Action is a single player/host input directed at the current round.
type Action struct {
	Name    string         // round-specific verb, e.g. "reveal", "guess", "vote"
	Actor   *Player        // resolved player performing the action (nil for system)
	IsHost  bool           // whether the actor holds host authority
	Payload map[string]any // free-form arguments
}

func (a Action) Str(key string) string {
	if v, ok := a.Payload[key].(string); ok {
		return v
	}
	return ""
}

func (a Action) Int(key string) (int, bool) {
	switch v := a.Payload[key].(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	}
	return 0, false
}

func (a Action) Bool(key string) bool {
	v, _ := a.Payload[key].(bool)
	return v
}

// RoundHandler is the plugin contract every round type implements. Handlers are
// stateless; per-round state lives in Room.Current.Data (a RoundData value the
// handler creates in Start and type-asserts back in Action/View).
type RoundHandler interface {
	Type() RoundType
	// Start builds the initial round data for the room's current round.
	Start(room *Room, cat Catalog) (RoundData, error)
	// Action applies an action, mutating room state (score, stage, result).
	Action(room *Room, act Action) error
	// View returns a redacted, JSON-serializable payload for the given viewer.
	View(room *Room, viewer *Player) any
}

// TimedRound is implemented by rounds that run against a countdown. The engine
// sets a deadline of now+Duration() when the round starts.
type TimedRound interface {
	Duration() time.Duration
}

// TimeoutHandler is implemented by timed rounds to resolve themselves when the
// deadline passes.
type TimeoutHandler interface {
	OnTimeout(room *Room)
}

var registry = map[RoundType]RoundHandler{}

func register(h RoundHandler) { registry[h.Type()] = h }

// Handler returns the registered handler for a round type.
func Handler(t RoundType) (RoundHandler, error) {
	h, ok := registry[t]
	if !ok {
		return nil, fmt.Errorf("no handler for round type %q", t)
	}
	return h, nil
}

// AvailableRoundTypes lists every registered round type.
func AvailableRoundTypes() []RoundType {
	out := make([]RoundType, 0, len(registry))
	for t := range registry {
		out = append(out, t)
	}
	return out
}

// ---- Content catalog (implemented by the store layer) ----

// Song is a track used by music rounds.
type Song struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Artist     string     `json:"artist"`
	Pack       string     `json:"pack"`
	Era        string     `json:"era"`
	Aliases    []string   `json:"aliases"`
	Phrases    [][]string `json:"phrases"`
	PreviewURL string     `json:"previewUrl"`
	YouTube    string     `json:"youtube"`
}

// Statement is a claim for the truth/lie round.
type Statement struct {
	ID    string `json:"id"`
	Text  string `json:"text"`
	Truth bool   `json:"truth"`
	Fact  string `json:"fact"` // explanation shown after reveal
	Pack  string `json:"pack"`
}

// AliasCard is a word (or short phrase) to explain in the alias round.
type AliasCard struct {
	ID     string   `json:"id"`
	Word   string   `json:"word"`
	Taboo  []string `json:"taboo"`
	Pack   string   `json:"pack"`
}

// CrocodilePuzzle is an emoji/description riddle for the crocodile round.
type CrocodilePuzzle struct {
	ID     string `json:"id"`
	Emoji  string `json:"emoji"`
	Answer string `json:"answer"`
	Hint   string `json:"hint"`
	Pack   string `json:"pack"`
}

// Catalog supplies round content. The store package implements it.
type Catalog interface {
	Songs(preset string) []Song
	Statements(pack string) []Statement
	AliasCards(pack string) []AliasCard
	CrocodilePuzzles(pack string) []CrocodilePuzzle
}
