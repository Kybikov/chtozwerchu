package game

import "errors"

func init() { register(truthLie{}) }

type truthLie struct{}

type truthLieData struct {
	Stmt Statement
	Vote *bool // active team's vote (true = "правда")
}

func (*truthLieData) Kind() RoundType { return RoundTruthLie }

func (truthLie) Type() RoundType { return RoundTruthLie }

const truthLiePoints = 2

func (truthLie) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.Statements("")
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	return &truthLieData{Stmt: pool[pickRandom(len(pool))]}, nil
}

func (truthLie) Action(room *Room, act Action) error {
	d, ok := room.Current.Data.(*truthLieData)
	if !ok {
		return ErrNoRound
	}
	if room.Stage != StagePlaying {
		return ErrBadStage
	}
	switch act.Name {
	case "vote":
		if !activeOrHost(room, act) {
			return errors.New("голосує команда, чия черга")
		}
		v := act.Bool("truth")
		d.Vote = &v
		won := v == d.Stmt.Truth
		resolveTruthLie(room, d, won)
		return nil
	case "force":
		if !act.IsHost {
			return ErrNotHost
		}
		resolveTruthLie(room, d, act.Bool("won"))
		return nil
	}
	return errors.New("невідома дія")
}

func resolveTruthLie(room *Room, d *truthLieData, won bool) {
	pts := 0
	if won {
		pts = truthLiePoints
		room.Teams[room.ActiveTeam].Score += pts
	}
	answer := "Брехня"
	if d.Stmt.Truth {
		answer = "Правда"
	}
	room.Current.Result = &RoundResult{
		Won:    won,
		Points: pts,
		Team:   room.ActiveTeam,
		Answer: answer,
		Detail: d.Stmt.Fact,
	}
	room.Stage = StageResult
}

func (truthLie) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*truthLieData)
	if !ok {
		return nil
	}
	out := map[string]any{
		"statement": d.Stmt.Text,
		"points":    truthLiePoints,
	}
	if room.Stage == StageResult {
		out["truth"] = d.Stmt.Truth
		out["fact"] = d.Stmt.Fact
		if d.Vote != nil {
			out["vote"] = *d.Vote
		}
	}
	return out
}
