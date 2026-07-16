package game

import (
	"errors"
	"time"
)

func init() { register(crocodile{}) }

type crocodile struct{}

// Duration is the countdown for a crocodile round.
func (crocodile) Duration() time.Duration { return 45 * time.Second }

// OnTimeout resolves the round as unguessed when time runs out.
func (crocodile) OnTimeout(room *Room) {
	if d, ok := room.Current.Data.(*crocodileData); ok {
		resolveCrocodile(room, d, false, "")
	}
}

type crocodileData struct {
	Puzzle    CrocodilePuzzle
	HintShown bool
}

func (*crocodileData) Kind() RoundType { return RoundCrocodile }

func (crocodile) Type() RoundType { return RoundCrocodile }

const crocodileMaxPoints = 3

func (crocodile) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.CrocodilePuzzles("")
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	return &crocodileData{Puzzle: pool[pickRandom(len(pool))]}, nil
}

func crocodilePoints(d *crocodileData) int {
	if d.HintShown {
		return crocodileMaxPoints - 1
	}
	return crocodileMaxPoints
}

func (crocodile) Action(room *Room, act Action) error {
	d, ok := room.Current.Data.(*crocodileData)
	if !ok {
		return ErrNoRound
	}
	if room.Stage != StagePlaying {
		return ErrBadStage
	}
	switch act.Name {
	case "hint":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		d.HintShown = true
		return nil
	case "guess":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		resolveCrocodile(room, d, matchesAny(act.Str("text"), d.Puzzle.Answer), act.Str("text"))
		return nil
	case "force":
		if !act.IsHost {
			return ErrNotHost
		}
		resolveCrocodile(room, d, act.Bool("won"), act.Str("text"))
		return nil
	}
	return errors.New("невідома дія")
}

func resolveCrocodile(room *Room, d *crocodileData, won bool, guess string) {
	pts := 0
	if won {
		pts = crocodilePoints(d)
		room.Teams[room.ActiveTeam].Score += pts
	}
	room.Current.Result = &RoundResult{
		Won:    won,
		Points: pts,
		Team:   room.ActiveTeam,
		Answer: d.Puzzle.Answer,
		Detail: guess,
	}
	room.Stage = StageResult
}

func (crocodile) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*crocodileData)
	if !ok {
		return nil
	}
	done := room.Stage == StageResult
	out := map[string]any{
		"emoji":     d.Puzzle.Emoji,
		"potential": crocodilePoints(d),
	}
	if d.HintShown || done {
		out["hint"] = d.Puzzle.Hint
	}
	if done {
		out["answer"] = d.Puzzle.Answer
	}
	return out
}
