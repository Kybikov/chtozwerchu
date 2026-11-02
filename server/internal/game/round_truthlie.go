package game

import (
	"errors"
	"time"
)

func init() { register(truthLie{}) }

type truthLie struct{}

// Duration is the countdown for a truth/lie round.
func (truthLie) Duration() time.Duration { return 25 * time.Second }

// OnTimeout resolves the round as a wrong answer when time runs out.
func (truthLie) OnTimeout(room *Room) {
	if d, ok := room.Current.Data.(*truthLieData); ok {
		if d.Poll != nil {
			finishTruthPoll(room, d)
		} else {
			resolveTruthLie(room, d, false)
		}
	}
}

type truthLieData struct {
	Stmt     Statement
	Vote     *bool // active team's vote (true = "правда")
	Poll     *TeamPoll
	Fallback bool
}

func (*truthLieData) Kind() RoundType { return RoundTruthLie }

func (truthLie) Type() RoundType { return RoundTruthLie }

const truthLiePoints = 2

func (truthLie) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.Statements("")
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	d := &truthLieData{Stmt: pool[pickRandom(len(pool))]}
	if room.Config.VoteMode == "players" {
		poll := newTeamPoll(room, room.ActiveTeam)
		if len(poll.Eligible) > 0 {
			d.Poll = poll
		} else {
			d.Fallback = true
		}
	}
	return d, nil
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
		v, ok := act.Payload["truth"].(bool)
		if !ok {
			return errors.New("Обери правду або брехню.")
		}
		if d.Poll != nil {
			if err := d.Poll.cast(act.Actor, v); err != nil {
				return err
			}
			if len(d.Poll.Choices) == len(d.Poll.Eligible) {
				finishTruthPoll(room, d)
			}
			return nil
		}
		if !activeOrHost(room, act) {
			return errors.New("голосує команда, чия черга")
		}
		d.Vote = &v
		won := v == d.Stmt.Truth
		resolveTruthLie(room, d, won)
		return nil
	case "close_vote":
		if !act.IsHost {
			return ErrNotHost
		}
		if d.Poll == nil {
			return ErrBadStage
		}
		finishTruthPoll(room, d)
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

func finishTruthPoll(room *Room, d *truthLieData) {
	result := d.Poll.result()
	d.Vote = result.Decision
	resolveTruthLie(room, d, result.Decision != nil && *result.Decision == d.Stmt.Truth)
	room.Current.Result.Voting = result
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
	done := room.Stage == StageResult
	if d.Poll != nil {
		out["voting"] = d.Poll.view(viewer, done)
	} else {
		out["voting"] = VoteView{Mode: "team", CanVote: !done && viewer != nil && (viewer.IsHost || viewer.Team == room.ActiveTeam), Fallback: d.Fallback}
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
