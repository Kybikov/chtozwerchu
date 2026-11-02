package server

import (
	"encoding/json"

	"chtozverchu/internal/game"
)

// inMsg is the envelope for every client → server message.
type inMsg struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type createPayload struct {
	MelodyMode string           `json:"melodyMode"`
	Protocol   int              `json:"protocol"`
	VoteMode   string           `json:"voteMode"`
	HostName   string           `json:"hostName"`
	HostTeam   game.Team        `json:"hostTeam"`
	GirlsName  string           `json:"girlsName"`
	BoysName   string           `json:"boysName"`
	Rounds     int              `json:"rounds"`
	RoundTypes []game.RoundType `json:"roundTypes"`
	Preset     string           `json:"preset"`
	AuthToken  string           `json:"authToken"`
}

type joinPayload struct {
	Protocol  int       `json:"protocol"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Team      game.Team `json:"team"`
	Token     string    `json:"token"`
	AuthToken string    `json:"authToken"`
}

type setTeamPayload struct {
	Team game.Team `json:"team"`
}

type configPayload struct {
	MelodyMode string           `json:"melodyMode"`
	VoteMode   string           `json:"voteMode"`
	Rounds     int              `json:"rounds"`
	RoundTypes []game.RoundType `json:"roundTypes"`
	Preset     string           `json:"preset"`
}

type actionPayload struct {
	Name      string         `json:"name"`
	Payload   map[string]any `json:"payload"`
	Round     int            `json:"round"`
	CardIndex *int           `json:"cardIndex,omitempty"`
}

type chatPayload struct {
	Text string `json:"text"`
}

// chatOut is a chat message pushed to clients.
type chatOut struct {
	Type string    `json:"type"` // "chat"
	From string    `json:"from"`
	Team game.Team `json:"team"`
	Text string    `json:"text"`
	TS   int64     `json:"ts"`
}

// youAreMsg identifies the client and hands it a private reconnect token.
type youAreMsg struct {
	TVToken  string `json:"tvToken,omitempty"`
	Type     string `json:"type"`
	PlayerID string `json:"playerId"`
	Token    string `json:"token"`
	Code     string `json:"code"`
	Host     bool   `json:"host"`
}

func errorMsg(message string) []byte {
	b, _ := json.Marshal(map[string]string{"type": "error", "message": message})
	return b
}

func stateMsg(view game.RoomView) []byte {
	b, _ := json.Marshal(struct {
		Type string `json:"type"`
		game.RoomView
	}{Type: "state", RoomView: view})
	return b
}
