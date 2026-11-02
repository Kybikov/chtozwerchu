package game

import "time"

// YouInfo tells a client who it is inside the room.
type YouInfo struct {
	PlayerID   string `json:"playerId"`
	Name       string `json:"name"`
	Team       Team   `json:"team"`
	IsHost     bool   `json:"host"`
	Registered bool   `json:"registered"`
}

// RoomView is the redacted, per-viewer snapshot sent over the wire.
type RoomView struct {
	Revision    uint64              `json:"revision"`
	ServerTime  int64               `json:"serverTime"`
	Media       *RoomMedia          `json:"media,omitempty"`
	Code        string              `json:"code"`
	Stage       Stage               `json:"stage"`
	Config      RoomConfig          `json:"config"`
	Teams       map[Team]*TeamState `json:"teams"`
	Players     []*Player           `json:"players"`
	ActiveTeam  Team                `json:"activeTeam"`
	RoundIndex  int                 `json:"roundIndex"`
	Rounds      int                 `json:"rounds"`
	RoundType   RoundType           `json:"roundType,omitempty"`
	DeadlineMs  int64               `json:"deadlineMs,omitempty"`
	Round       any                 `json:"round,omitempty"`
	Result      *RoundResult        `json:"result,omitempty"`
	You         *YouInfo            `json:"you,omitempty"`
	Winner      Team                `json:"winner,omitempty"`
	Paused      bool                `json:"paused"`
	RemainingMs int64               `json:"remainingMs,omitempty"`
	History     []RoundSummary      `json:"history"`
}

// BuildView renders the room for a specific viewer (may be nil for spectators).
func BuildView(room *Room, viewer *Player) RoomView {
	v := RoomView{
		Revision:   room.Revision,
		ServerTime: time.Now().UnixMilli(),
		Media:      room.Media,
		Code:       room.Code,
		Stage:      room.Stage,
		Config:     room.Config,
		Teams:      room.Teams,
		Players:    room.Players,
		ActiveTeam: room.ActiveTeam,
		RoundIndex: room.RoundIndex,
		Rounds:     room.Config.Rounds,
		Paused:     room.Paused,
		History:    room.History,
	}
	if room.Current != nil {
		if room.Paused {
			v.RemainingMs = room.Current.PausedRemaining.Milliseconds()
		}
		v.RoundType = room.Current.Type
		if !room.Current.Deadline.IsZero() {
			v.DeadlineMs = room.Current.Deadline.UnixMilli()
		}
		if h, err := Handler(room.Current.Type); err == nil {
			v.Round = h.View(room, viewer)
		}
		if room.Stage == StageResult {
			v.Result = room.Current.Result
		}
	}
	if viewer != nil {
		v.You = &YouInfo{
			PlayerID:   viewer.ID,
			Name:       viewer.Name,
			Team:       viewer.Team,
			IsHost:     viewer.IsHost,
			Registered: viewer.UserID != nil,
		}
	}
	if room.Stage == StageFinal {
		v.Winner = winner(room)
	}
	return v
}

// Winner returns the leading team, or "" on a draw.
func Winner(room *Room) Team { return winner(room) }

func winner(room *Room) Team {
	g := room.Teams[TeamGirls].Score
	b := room.Teams[TeamBoys].Score
	switch {
	case g > b:
		return TeamGirls
	case b > g:
		return TeamBoys
	default:
		return "" // draw
	}
}
