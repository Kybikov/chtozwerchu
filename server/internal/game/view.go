package game

// YouInfo tells a client who it is inside the room.
type YouInfo struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Team     Team   `json:"team"`
	IsHost   bool   `json:"host"`
}

// RoomView is the redacted, per-viewer snapshot sent over the wire.
type RoomView struct {
	Code       string              `json:"code"`
	Stage      Stage               `json:"stage"`
	Config     RoomConfig          `json:"config"`
	Teams      map[Team]*TeamState `json:"teams"`
	Players    []*Player           `json:"players"`
	ActiveTeam Team                `json:"activeTeam"`
	RoundIndex int                 `json:"roundIndex"`
	Rounds     int                 `json:"rounds"`
	RoundType  RoundType           `json:"roundType,omitempty"`
	Round      any                 `json:"round,omitempty"`
	You        *YouInfo            `json:"you,omitempty"`
	Winner     Team                `json:"winner,omitempty"`
}

// BuildView renders the room for a specific viewer (may be nil for spectators).
func BuildView(room *Room, viewer *Player) RoomView {
	v := RoomView{
		Code:       room.Code,
		Stage:      room.Stage,
		Config:     room.Config,
		Teams:      room.Teams,
		Players:    room.Players,
		ActiveTeam: room.ActiveTeam,
		RoundIndex: room.RoundIndex,
		Rounds:     room.Config.Rounds,
	}
	if room.Current != nil {
		v.RoundType = room.Current.Type
		if h, err := Handler(room.Current.Type); err == nil {
			v.Round = h.View(room, viewer)
		}
	}
	if viewer != nil {
		v.You = &YouInfo{
			PlayerID: viewer.ID,
			Name:     viewer.Name,
			Team:     viewer.Team,
			IsHost:   viewer.IsHost,
		}
	}
	if room.Stage == StageFinal {
		v.Winner = winner(room)
	}
	return v
}

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
