package game

import "time"

// Team is one of the two competing sides.
type Team string

const (
	TeamGirls Team = "girls"
	TeamBoys  Team = "boys"
)

func (t Team) Opposite() Team {
	if t == TeamGirls {
		return TeamBoys
	}
	return TeamGirls
}

func (t Team) Valid() bool { return t == TeamGirls || t == TeamBoys }

// Stage is the high-level room lifecycle state.
type Stage string

const (
	StageLobby   Stage = "lobby"
	StagePlaying Stage = "playing"
	StageResult  Stage = "result"
	StageFinal   Stage = "final"
)

// RoundType identifies a round plugin.
type RoundType string

const (
	RoundFiveWords RoundType = "five_words"
	RoundMelody    RoundType = "melody"
	RoundAlias     RoundType = "alias"
	RoundCrocodile RoundType = "crocodile"
	RoundTruthLie  RoundType = "truth_lie"
)

// Player is a participant in a room.
type Player struct {
	ID        string    `json:"id"`
	Token     string    `json:"-"` // secret reconnect token, never sent to clients
	Name      string    `json:"name"`
	Team      Team      `json:"team"`
	IsHost    bool      `json:"host"`
	UserID    *string   `json:"userId,omitempty"` // set when registered
	Connected bool      `json:"connected"`
	JoinedAt  time.Time `json:"joinedAt"`
}

// TeamState carries per-team name and running score.
type TeamState struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

// RoundSpec is a planned round in the deck (type + optional content id).
type RoundSpec struct {
	Type RoundType `json:"type"`
}

// RoundState is the live state of the current round. The concrete shape lives
// in the round-specific Data payload; the engine only tracks common fields.
type RoundState struct {
	Type       RoundType    `json:"type"`
	ActiveTeam Team         `json:"activeTeam"`
	Data       RoundData    `json:"-"` // in-memory typed state, never serialized directly
	Result     *RoundResult `json:"result,omitempty"`
	StartedAt  time.Time    `json:"startedAt"`
	Deadline   time.Time    `json:"-"` // zero when the round is untimed
}

// RoundResult is the outcome of a resolved round.
type RoundResult struct {
	Won    bool   `json:"won"`
	Points int    `json:"points"`
	Team   Team   `json:"team"`
	Answer string `json:"answer"`
	Detail string `json:"detail,omitempty"`
}

// RoundData is implemented by each round's internal state struct.
type RoundData interface {
	Kind() RoundType
}

// RoomConfig holds host-chosen settings.
type RoomConfig struct {
	Rounds     int         `json:"rounds"`
	RoundTypes []RoundType `json:"roundTypes"`
	Preset     string      `json:"preset"`
}

// Room is the authoritative game state for a single lobby/match.
type Room struct {
	Code       string             `json:"code"`
	HostToken  string             `json:"-"`
	Stage      Stage              `json:"stage"`
	Config     RoomConfig         `json:"config"`
	Teams      map[Team]*TeamState `json:"teams"`
	Players    []*Player          `json:"players"`
	ActiveTeam Team               `json:"activeTeam"`
	RoundIndex int                `json:"roundIndex"` // 1-based number of the current round
	Deck       []RoundSpec        `json:"-"`
	Current    *RoundState        `json:"-"`
	CreatedAt  time.Time          `json:"createdAt"`
	UpdatedAt  time.Time          `json:"updatedAt"`
}

func (r *Room) playerByID(id string) *Player {
	for _, p := range r.Players {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (r *Room) playerByToken(tok string) *Player {
	for _, p := range r.Players {
		if p.Token == tok {
			return p
		}
	}
	return nil
}

func (r *Room) host() *Player {
	for _, p := range r.Players {
		if p.IsHost {
			return p
		}
	}
	return nil
}
