package game

import (
	"errors"
	"time"
)

const melodyAnswerTime = 10 * time.Second

type melodyBuzzer struct {
	Phase           string
	Team            Team
	PlayerName      string
	Attempt         int
	Blocked         map[Team]bool
	ListenRemaining time.Duration
	Points          int
	Notice          string
}

type BuzzerView struct {
	Phase      string `json:"phase"`
	Team       Team   `json:"team,omitempty"`
	PlayerName string `json:"playerName,omitempty"`
	Attempt    int    `json:"attempt"`
	Blocked    []Team `json:"blocked"`
	CanBuzz    bool   `json:"canBuzz"`
	CanAnswer  bool   `json:"canAnswer"`
	Notice     string `json:"notice,omitempty"`
}

// MelodyAnswerWindow separates the answer clock from acknowledged music playback.
func MelodyAnswerWindow(r *Room) bool {
	if r.Current == nil || r.Current.Type != RoundMelody {
		return false
	}
	d, ok := r.Current.Data.(*melodyData)
	return ok && d.Buzzer != nil && d.Buzzer.Phase == "answer"
}

func melodyResume(r *Room) {
	if r.Current == nil || r.Current.Type != RoundMelody {
		return
	}
	if d, ok := r.Current.Data.(*melodyData); ok && d.Buzzer != nil && d.Buzzer.Phase == "handoff" {
		d.Buzzer.Phase = "open"
	}
}

func claimMelody(r *Room, d *melodyData, act Action) error {
	b := d.Buzzer
	if b == nil {
		return errors.New("У цьому режимі команда відповідає по черзі.")
	}
	team, name := Team(""), ""
	if act.IsHost {
		team, name = Team(act.Str("team")), "Ведучий"
	} else if act.Actor != nil && act.Actor.Connected {
		team, name = act.Actor.Team, act.Actor.Name
	}
	if !team.Valid() {
		return errors.New("Обери команду, яка впізнала пісню.")
	}
	if b.Blocked[team] {
		return errors.New("Ця команда вже використала свій шанс.")
	}
	if b.Phase != "open" || d.AwaitingAudio || r.Current.Deadline.IsZero() || time.Until(r.Current.Deadline) <= 0 {
		return errors.New("Кнопка ще закрита або право відповіді вже зайняте.")
	}
	b.ListenRemaining = time.Until(r.Current.Deadline)
	b.Points = melodyPoints(r, d)
	b.Team, b.PlayerName = team, name
	b.Attempt++
	b.Phase = "answer"
	b.Notice = ""
	r.StopMedia()
	r.Current.Deadline = time.Now().Add(melodyAnswerTime)
	r.Current.PausedRemaining = 0
	return nil
}

func failMelodyClaim(r *Room, d *melodyData, timedOut bool) {
	b := d.Buzzer
	b.Blocked[b.Team] = true
	if timedOut {
		b.Notice = "Час на відповідь вичерпано."
	} else {
		b.Notice = "Цього разу не вгадали."
	}
	r.StopMedia()
	if b.Blocked[TeamGirls] && b.Blocked[TeamBoys] || b.ListenRemaining <= 0 {
		b.Phase = "closed"
		resolveMelody(r, d, false, "Обидві команди використали свій шанс.")
		return
	}
	b.Team = ""
	b.PlayerName = ""
	b.Phase = "handoff"
	r.Current.Deadline = time.Time{}
	r.Current.PausedRemaining = b.ListenRemaining
	r.Paused = true
}

func melodyAnswerAllowed(r *Room, d *melodyData, act Action) bool {
	return d.Buzzer != nil && d.Buzzer.Phase == "answer" && (act.IsHost || act.Actor != nil && act.Actor.Connected && act.Actor.Team == d.Buzzer.Team)
}

func buzzerView(r *Room, d *melodyData, viewer *Player) BuzzerView {
	b := d.Buzzer
	v := BuzzerView{Phase: b.Phase, Team: b.Team, PlayerName: b.PlayerName, Attempt: b.Attempt, Notice: b.Notice, Blocked: []Team{}}
	for _, team := range []Team{TeamGirls, TeamBoys} {
		if b.Blocked[team] {
			v.Blocked = append(v.Blocked, team)
		}
	}
	if viewer != nil && r.Stage == StagePlaying && !r.Paused {
		v.CanBuzz = b.Phase == "open" && !d.AwaitingAudio && !b.Blocked[viewer.Team]
		v.CanAnswer = b.Phase == "answer" && (viewer.IsHost || viewer.Team == b.Team)
	}
	return v
}
