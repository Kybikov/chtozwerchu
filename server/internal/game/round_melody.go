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
		if d.Buzzer != nil && d.Buzzer.Phase == "answer" {
			failMelodyClaim(room, d, true)
			return
		}
		resolveMelody(room, d, false, "")
	}
}

type melodyData struct {
	Buzzer        *melodyBuzzer
	PreviewStatus string
	AwaitingAudio bool
	Song          Song
	Hints         int // 0..2
}

func (*melodyData) Kind() RoundType { return RoundMelody }

func (melody) Type() RoundType { return RoundMelody }

const melodyMaxPoints = 3

func (melody) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.Songs(room.Config.Preset)
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	d := &melodyData{Song: pool[pickRandom(len(pool))], AwaitingAudio: true}
	if room.Config.MelodyMode == "buzzer" {
		d.Buzzer = &melodyBuzzer{Phase: "open", Blocked: map[Team]bool{}}
	}
	return d, nil
}

func melodyPoints(room *Room, d *melodyData) int {
	if d.Buzzer != nil && d.Buzzer.Phase == "answer" {
		return d.Buzzer.Points
	}
	p := melodyMaxPoints - d.Hints
	left := time.Until(room.Current.Deadline)
	if room.Paused {
		left = room.Current.PausedRemaining
	}
	if left <= 25*time.Second {
		p--
	}
	if left <= 10*time.Second {
		p--
	}
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
	case "end_melody":
		if !act.IsHost {
			return ErrNotHost
		}
		room.Paused = false
		resolveMelody(room, d, false, "Ведучий пропустив мелодію.")
		return nil
	case "buzz":
		return claimMelody(room, d, act)
	case "hint":
		if d.Buzzer != nil && (!act.IsHost || d.Buzzer.Phase == "answer") || d.Buzzer == nil && !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		if d.Hints < 2 {
			d.Hints++
		}
		return nil
	case "guess":
		if d.Buzzer != nil {
			if !melodyAnswerAllowed(room, d, act) {
				return errors.New("Зараз відповідає команда, яка натиснула першою.")
			}
			guess := act.Str("text")
			if matchesAny(guess, append([]string{d.Song.Title, d.Song.Artist}, d.Song.Aliases...)...) {
				resolveMelody(room, d, true, guess)
			} else {
				failMelodyClaim(room, d, false)
			}
			return nil
		}
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
		if d.Buzzer != nil {
			if d.Buzzer.Phase == "answer" {
				if act.Bool("won") {
					resolveMelody(room, d, true, act.Str("text"))
				} else {
					failMelodyClaim(room, d, false)
				}
				return nil
			}
			if act.Bool("won") {
				return errors.New("Спочатку зафіксуй команду кнопкою «Знаю пісню».")
			}
		}
		resolveMelody(room, d, act.Bool("won"), act.Str("text"))
		return nil
	}
	return errors.New("невідома дія")
}

func resolveMelody(room *Room, d *melodyData, won bool, guess string) {
	team := room.ActiveTeam
	if d.Buzzer != nil && d.Buzzer.Team.Valid() {
		team = d.Buzzer.Team
	}
	pts := 0
	if won {
		pts = melodyPoints(room, d)
		room.Teams[team].Score += pts
	}
	room.Current.Result = &RoundResult{
		Won:    won,
		Points: pts,
		Team:   team,
		Answer: d.Song.Title + " — " + d.Song.Artist,
		Detail: guess,
	}
	room.Stage = StageResult
	if d.Buzzer != nil {
		d.Buzzer.Phase = "closed"
	}
}

func (melody) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*melodyData)
	if !ok {
		return nil
	}
	done := room.Stage == StageResult
	out := map[string]any{
		"previewUrl":    d.Song.PreviewURL,
		"potential":     melodyPoints(room, d),
		"hints":         melodyHints(d),
		"previewStatus": d.PreviewStatus,
		"awaitingAudio": d.AwaitingAudio,
	}
	if d.Buzzer != nil {
		out["buzzer"] = buzzerView(room, d, viewer)
	}
	if viewer != nil && viewer.IsHost {
		out["hostAnswer"] = d.Song.Title + " — " + d.Song.Artist
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
	if url == "" {
		d.PreviewStatus = "unavailable"
	} else {
		d.PreviewStatus = "ready"
	}
	return true
}

func firstLetter(s string) string {
	for _, r := range s {
		return string(r)
	}
	return ""
}
