package game

import (
	"encoding/json"
	"errors"
	"time"
)

// PrivateSnapshot is for the server's private state volume. Never send it to a
// player: it contains reconnect capabilities and the hidden contest content.
type PrivateSnapshot struct {
	Room      *Room              `json:"room"`
	MatchID   string             `json:"matchId"`
	HostToken string             `json:"hostToken"`
	TVToken   string             `json:"tvToken"`
	Tokens    map[string]string  `json:"tokens"`
	Accounts  map[string]*string `json:"accounts"`
	Deck      []RoundSpec        `json:"deck"`
	Current   *RoundState        `json:"current,omitempty"`
	Data      json.RawMessage    `json:"data,omitempty"`
	Remaining time.Duration      `json:"remaining"`
}

func Snapshot(r *Room) ([]byte, error) {
	snap := PrivateSnapshot{Room: r, MatchID: r.MatchID, HostToken: r.HostToken, TVToken: r.TVToken, Tokens: map[string]string{}, Accounts: map[string]*string{}, Deck: r.Deck, Current: r.Current}
	for _, p := range r.Players {
		snap.Tokens[p.ID] = p.Token
		snap.Accounts[p.ID] = p.UserID
	}
	if r.Current != nil {
		var err error
		snap.Data, err = json.Marshal(r.Current.Data)
		if err != nil {
			return nil, err
		}
		snap.Remaining = r.Current.PausedRemaining
		if !r.Current.Deadline.IsZero() {
			snap.Remaining = max(time.Until(r.Current.Deadline), time.Millisecond)
		}
	}
	return json.Marshal(snap)
}
func RestoreSnapshot(raw []byte) (*Room, error) {
	var s PrivateSnapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	r := s.Room
	if r == nil || len(r.Code) != 5 || len(s.MatchID) < 20 || len(s.HostToken) < 20 || len(r.Players) > 64 || len(s.Deck) > 60 || r.Config.Rounds < 1 || r.Config.Rounds > 60 || r.Teams[TeamGirls] == nil || r.Teams[TeamBoys] == nil {
		return nil, errors.New("invalid private room snapshot")
	}
	r.MatchID = s.MatchID
	r.HostToken = s.HostToken
	r.TVToken = s.TVToken
	r.EnsureMedia()
	r.StopMedia()
	r.Media.Ready = false
	r.Media.Connected = false
	r.Media.TVConnected = false
	r.Media.Enabled = false
	r.Media.Revision++
	r.Deck = s.Deck
	r.Current = s.Current
	for _, p := range r.Players {
		if len(s.Tokens[p.ID]) < 20 {
			return nil, errors.New("invalid player capability")
		}
		p.Token = s.Tokens[p.ID]
		p.UserID = s.Accounts[p.ID]
		p.Connected = false
	}
	if r.Current != nil {
		var data RoundData
		switch r.Current.Type {
		case RoundFiveWords:
			data = &fiveWordsData{}
		case RoundMelody:
			data = &melodyData{}
		case RoundAlias:
			data = &aliasData{}
		case RoundCrocodile:
			data = &crocodileData{}
		case RoundTruthLie:
			data = &truthLieData{}
		default:
			return nil, errors.New("unknown restored contest")
		}
		if err := json.Unmarshal(s.Data, data); err != nil {
			return nil, err
		}
		r.Current.Data = data
		r.Current.Deadline = time.Time{}
		r.Current.PausedRemaining = s.Remaining
		if r.Stage == StagePlaying {
			r.Paused = true
			RefreshMelodyPreview(r)
		}
	}
	return r, nil
}
