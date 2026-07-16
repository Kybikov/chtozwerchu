package game

import (
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"
)

var (
	ErrNoRound     = errors.New("немає активного раунду")
	ErrNotHost     = errors.New("тільки ведучий може це робити")
	ErrBadStage    = errors.New("дія недоступна на цьому етапі")
	ErrEmptyDeck   = errors.New("немає контенту для обраних раундів")
	ErrRoomClosed  = errors.New("кімната недоступна")
)

// Engine applies rules to rooms. It is stateless apart from the content
// catalog; callers must serialize access to a given Room.
type Engine struct {
	cat Catalog
}

func NewEngine(cat Catalog) *Engine { return &Engine{cat: cat} }

func (e *Engine) Catalog() Catalog { return e.cat }

// CreateParams are the inputs for creating a room.
type CreateParams struct {
	HostName   string
	HostTeam   Team
	GirlsName  string
	BoysName   string
	Rounds     int
	RoundTypes []RoundType
	Preset     string
	UserID     *string
}

// CreateRoom builds a fresh lobby with the host as its first player.
func (e *Engine) CreateRoom(p CreateParams) (*Room, *Player) {
	if !p.HostTeam.Valid() {
		p.HostTeam = TeamGirls
	}
	rounds := clamp(p.Rounds, 1, 60)
	if rounds == 0 {
		rounds = 12
	}
	types := sanitizeTypes(p.RoundTypes)
	now := time.Now()
	host := &Player{
		ID:        "p-" + shortID(),
		Token:     longID(),
		Name:      firstNonEmpty(strings.TrimSpace(p.HostName), "Ведучий"),
		Team:      p.HostTeam,
		IsHost:    true,
		UserID:    p.UserID,
		Connected: true,
		JoinedAt:  now,
	}
	room := &Room{
		Code:      newCode(),
		HostToken: longID(),
		Stage:     StageLobby,
		Config: RoomConfig{
			Rounds:     rounds,
			RoundTypes: types,
			Preset:     firstNonEmpty(p.Preset, "party"),
		},
		Teams: map[Team]*TeamState{
			TeamGirls: {Name: firstNonEmpty(strings.TrimSpace(p.GirlsName), "Дівчата")},
			TeamBoys:  {Name: firstNonEmpty(strings.TrimSpace(p.BoysName), "Хлопці")},
		},
		Players:    []*Player{host},
		ActiveTeam: p.HostTeam,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	return room, host
}

// Join adds a player, or reconnects an existing one by token.
func (e *Engine) Join(room *Room, name string, team Team, token string) (*Player, error) {
	if token != "" {
		if p := room.playerByToken(token); p != nil {
			p.Connected = true
			if name != "" {
				p.Name = name
			}
			if team.Valid() {
				p.Team = team
			}
			room.touch()
			return p, nil
		}
	}
	if !team.Valid() {
		team = TeamGirls
	}
	p := &Player{
		ID:        "p-" + shortID(),
		Token:     longID(),
		Name:      firstNonEmpty(strings.TrimSpace(name), "Гравець"),
		Team:      team,
		Connected: true,
		JoinedAt:  time.Now(),
	}
	room.Players = append(room.Players, p)
	room.touch()
	return p, nil
}

// SetConfig updates lobby settings (host only, lobby stage only).
func (e *Engine) SetConfig(room *Room, rounds int, types []RoundType, preset string) {
	if room.Stage != StageLobby {
		return
	}
	if rounds > 0 {
		room.Config.Rounds = clamp(rounds, 1, 60)
	}
	if len(types) > 0 {
		room.Config.RoundTypes = sanitizeTypes(types)
	}
	if preset != "" {
		room.Config.Preset = preset
	}
	room.touch()
}

// SetPlayerTeam moves a player between teams in the lobby.
func (e *Engine) SetPlayerTeam(room *Room, player *Player, team Team) {
	if room.Stage != StageLobby || player == nil || !team.Valid() {
		return
	}
	player.Team = team
	room.touch()
}

// StartGame builds the deck and opens the first round.
func (e *Engine) StartGame(room *Room) error {
	if room.Stage != StageLobby {
		return ErrBadStage
	}
	deck, err := e.buildDeck(room)
	if err != nil {
		return err
	}
	room.Deck = deck
	room.RoundIndex = 0
	return e.startRound(room)
}

func (e *Engine) buildDeck(room *Room) ([]RoundSpec, error) {
	types := room.Config.RoundTypes
	if len(types) == 0 {
		types = []RoundType{RoundFiveWords}
	}
	// Keep only round types that actually have content available.
	playable := types[:0:0]
	for _, t := range types {
		if e.hasContent(room, t) {
			playable = append(playable, t)
		}
	}
	if len(playable) == 0 {
		return nil, ErrEmptyDeck
	}
	deck := make([]RoundSpec, 0, room.Config.Rounds)
	for i := 0; i < room.Config.Rounds; i++ {
		deck = append(deck, RoundSpec{Type: playable[i%len(playable)]})
	}
	return deck, nil
}

func (e *Engine) hasContent(room *Room, t RoundType) bool {
	switch t {
	case RoundFiveWords:
		for _, s := range e.cat.Songs(room.Config.Preset) {
			if len(s.Phrases) > 0 {
				return true
			}
		}
		return false
	case RoundMelody:
		return len(e.cat.Songs(room.Config.Preset)) > 0
	case RoundTruthLie:
		return len(e.cat.Statements("")) > 0
	case RoundAlias:
		return len(e.cat.AliasCards("")) > 0
	case RoundCrocodile:
		return len(e.cat.CrocodilePuzzles("")) > 0
	}
	return false
}

func (e *Engine) startRound(room *Room) error {
	if room.RoundIndex >= len(room.Deck) {
		room.Stage = StageFinal
		room.Current = nil
		room.touch()
		return nil
	}
	spec := room.Deck[room.RoundIndex]
	room.RoundIndex++
	h, err := Handler(spec.Type)
	if err != nil {
		return err
	}
	data, err := h.Start(room, e.cat)
	if err != nil {
		return err
	}
	room.Current = &RoundState{
		Type:       spec.Type,
		ActiveTeam: room.ActiveTeam,
		Data:       data,
		StartedAt:  time.Now(),
	}
	if timed, ok := h.(TimedRound); ok {
		room.Current.Deadline = time.Now().Add(timed.Duration())
	}
	room.Stage = StagePlaying
	room.touch()
	return nil
}

// Timeout resolves the current round when its deadline passes.
func (e *Engine) Timeout(room *Room) {
	if room.Current == nil || room.Stage != StagePlaying {
		return
	}
	h, err := Handler(room.Current.Type)
	if err != nil {
		return
	}
	if to, ok := h.(TimeoutHandler); ok {
		to.OnTimeout(room)
		room.touch()
	}
}

// Apply routes an action to engine-level handlers or the current round.
func (e *Engine) Apply(room *Room, act Action) error {
	switch act.Name {
	case "next":
		if !act.IsHost {
			return ErrNotHost
		}
		return e.Next(room)
	case "finish":
		if !act.IsHost {
			return ErrNotHost
		}
		room.Stage = StageFinal
		room.Current = nil
		room.touch()
		return nil
	case "lobby":
		if !act.IsHost {
			return ErrNotHost
		}
		return e.ToLobby(room)
	default:
		if room.Current == nil {
			return ErrNoRound
		}
		h, err := Handler(room.Current.Type)
		if err != nil {
			return err
		}
		if err := h.Action(room, act); err != nil {
			return err
		}
		room.touch()
		return nil
	}
}

// Next flips the active team and starts the next round.
func (e *Engine) Next(room *Room) error {
	if room.Stage != StageResult && room.Stage != StagePlaying {
		return ErrBadStage
	}
	room.ActiveTeam = room.ActiveTeam.Opposite()
	return e.startRound(room)
}

// ToLobby resets scores and returns the room to the lobby for a new game.
func (e *Engine) ToLobby(room *Room) error {
	room.Stage = StageLobby
	room.Current = nil
	room.Deck = nil
	room.RoundIndex = 0
	for _, t := range room.Teams {
		t.Score = 0
	}
	room.touch()
	return nil
}

func (r *Room) touch() { r.UpdatedAt = time.Now() }

// ---- helpers ----

func sanitizeTypes(in []RoundType) []RoundType {
	out := make([]RoundType, 0, len(in))
	seen := map[RoundType]bool{}
	for _, t := range in {
		if _, err := Handler(t); err == nil && !seen[t] {
			out = append(out, t)
			seen[t] = true
		}
	}
	if len(out) == 0 {
		return []RoundType{RoundFiveWords}
	}
	return out
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newCode() string {
	b := make([]byte, 5)
	for i := range b {
		b[i] = codeAlphabet[randInt(len(codeAlphabet))]
	}
	return string(b)
}

func shortID() string { return randHex(6) }
func longID() string  { return randHex(20) }

func randHex(n int) string {
	const hex = "0123456789abcdef"
	b := make([]byte, n)
	for i := range b {
		b[i] = hex[randInt(16)]
	}
	return string(b)
}

func randInt(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(v.Int64())
}
