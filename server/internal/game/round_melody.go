package game

import (
	"errors"
	"time"
)

func init() { register(melody{}) }

type melody struct{}

// Duration is the countdown for a melody round.
func (melody) Duration() time.Duration { return 40 * time.Second }

// OnTimeout resolves the round as unguessed when time runs out.
func (melody) OnTimeout(room *Room) {
	if d, ok := room.Current.Data.(*melodyData); ok {
		resolveMelody(room, d, false, "")
	}
}

type melodyData struct {
	Song  Song
	Hints int // 0..2
}

func (*melodyData) Kind() RoundType { return RoundMelody }

func (melody) Type() RoundType { return RoundMelody }

const melodyMaxPoints = 3

func (melody) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.Songs(room.Config.Preset)
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	return &melodyData{Song: pool[pickRandom(len(pool))]}, nil
}

func melodyPoints(d *melodyData) int {
	p := melodyMaxPoints - d.Hints
	if p < 1 {
		return 1
	}
	return p
}

func (melody) Action(room *Room, act Action) error {
	d, ok := room.Current.Data.(*melodyData)
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
		if d.Hints < 2 {
			d.Hints++
		}
		return nil
	case "guess":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		guess := act.Str("text")
		cands := append([]string{d.Song.Title, d.Song.Artist}, d.Song.Aliases...)
		resolveMelody(room, d, matchesAny(guess, cands...), guess)
		return nil
	case "force":
		if !act.IsHost {
			return ErrNotHost
		}
		resolveMelody(room, d, act.Bool("won"), act.Str("text"))
		return nil
	}
	return errors.New("невідома дія")
}

func resolveMelody(room *Room, d *melodyData, won bool, guess string) {
	pts := 0
	if won {
		pts = melodyPoints(d)
		room.Teams[room.ActiveTeam].Score += pts
	}
	room.Current.Result = &RoundResult{
		Won:    won,
		Points: pts,
		Team:   room.ActiveTeam,
		Answer: d.Song.Title + " — " + d.Song.Artist,
		Detail: guess,
	}
	room.Stage = StageResult
}

func (melody) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*melodyData)
	if !ok {
		return nil
	}
	done := room.Stage == StageResult
	out := map[string]any{
		"previewUrl": d.Song.PreviewURL,
		"potential":  melodyPoints(d),
		"hints":      melodyHints(d),
	}
	if done {
		out["song"] = map[string]any{
			"title":   d.Song.Title,
			"artist":  d.Song.Artist,
			"youtube": d.Song.YouTube,
		}
	}
	return out
}

func melodyHints(d *melodyData) []string {
	var hints []string
	if d.Hints >= 1 && len(d.Song.Title) > 0 {
		hints = append(hints, "Перша літера назви: "+firstLetter(d.Song.Title))
	}
	if d.Hints >= 2 {
		hints = append(hints, "Виконавець: "+d.Song.Artist)
	}
	return hints
}

// MelodyPreviewNeeded returns the current melody round's track when it still
// needs a preview URL resolved.
func MelodyPreviewNeeded(room *Room) (title, artist string, ok bool) {
	if room == nil || room.Current == nil || room.Current.Type != RoundMelody {
		return "", "", false
	}
	d, is := room.Current.Data.(*melodyData)
	if !is || d.Song.PreviewURL != "" {
		return "", "", false
	}
	return d.Song.Title, d.Song.Artist, true
}

// SetMelodyPreview sets the preview URL on the current melody round.
func SetMelodyPreview(room *Room, url string) bool {
	if room == nil || room.Current == nil || room.Current.Type != RoundMelody {
		return false
	}
	d, ok := room.Current.Data.(*melodyData)
	if !ok || d.Song.PreviewURL != "" {
		return false
	}
	d.Song.PreviewURL = url
	return true
}

func firstLetter(s string) string {
	for _, r := range s {
		return string(r)
	}
	return ""
}
