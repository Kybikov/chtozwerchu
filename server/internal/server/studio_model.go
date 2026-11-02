package server

import (
	"errors"
	"math"
	"strings"
	"time"
)

type studioHistory struct {
	Round   int     `json:"round"`
	Team    string  `json:"team"`
	Awarded *string `json:"awarded"`
	Track   string  `json:"track"`
	Line    string  `json:"line"`
	TrackID int64   `json:"trackId"`
	Target  int     `json:"target"`
}
type studioSession struct {
	Programme     *studioProgramme  `json:"programme,omitempty"`
	MatchID       string            `json:"matchId"`
	Scores        map[string]int    `json:"scores"`
	Names         map[string]string `json:"names"`
	Team          string            `json:"team"`
	Round         int               `json:"round"`
	Rounds        int               `json:"rounds"`
	TrackID       int64             `json:"trackId"`
	Offset        int64             `json:"offset"`
	Aligned       bool              `json:"aligned"`
	Target        int               `json:"target"`
	AnswerSeconds int               `json:"answerSeconds"`
	History       []studioHistory   `json:"history"`
	Finished      bool              `json:"finished"`
}
type studioProgramme struct {
	Title    string  `json:"title"`
	TrackIDs []int64 `json:"trackIds"`
}

func validStudioProgramme(p *studioProgramme, rounds int) bool {
	if p == nil {
		return true
	}
	if len([]rune(strings.TrimSpace(p.Title))) < 1 || len([]rune(p.Title)) > 80 || !oneOf(len(p.TrackIDs), 4, 8, 12, 16) || len(p.TrackIDs) != rounds {
		return false
	}
	seen := map[int64]bool{}
	for _, id := range p.TrackIDs {
		if id <= 0 || id > 999999999999999 || seen[id] {
			return false
		}
		seen[id] = true
	}
	return true
}

type studioAudio struct {
	Volume   int     `json:"volume"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
	Playing  bool    `json:"playing"`
	Ready    bool    `json:"ready"`
	Local    bool    `json:"local"`
}
type studioTimer struct {
	LeftMS   int64 `json:"leftMs"`
	Deadline int64 `json:"deadline"`
	Paused   bool  `json:"paused"`
}
type studioState struct {
	Library    []studioPrepared `json:"library,omitempty"`
	Session    studioSession    `json:"session"`
	Track      musicTrack       `json:"track"`
	Audio      studioAudio      `json:"audio"`
	Phase      string           `json:"phase"`
	Awarded    *string          `json:"awarded"`
	Timer      studioTimer      `json:"timer"`
	Version    uint64           `json:"version"`
	Effects    bool             `json:"effects"`
	NeedsTrack bool             `json:"needsTrack"`
	Notice     string           `json:"notice"`
}
type studioAction struct {
	Type     string        `json:"type"`
	ID       string        `json:"id"`
	Version  uint64        `json:"version"`
	Team     *string       `json:"team,omitempty"`
	Index    int           `json:"index,omitempty"`
	Position float64       `json:"position,omitempty"`
	TrackID  int64         `json:"trackId,omitempty"`
	Config   *studioConfig `json:"config,omitempty"`
}
type studioConfig struct {
	Names         map[string]string `json:"names"`
	Rounds        int               `json:"rounds"`
	AnswerSeconds int               `json:"answerSeconds"`
	Effects       bool              `json:"effects"`
}
type studioInstruction struct {
	Prepared bool    `json:"prepared,omitempty"`
	Type     string  `json:"type"`
	ID       string  `json:"id"`
	Position float64 `json:"position"`
	TrackID  int64   `json:"trackId,omitempty"`
}

type studioPrepared struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Cover    string  `json:"cover"`
	Duration float64 `json:"duration"`
	Local    bool    `json:"local"`
}

func validStudioLibrary(library []studioPrepared) bool {
	if len(library) > 40 {
		return false
	}
	seen := map[int64]bool{}
	for _, song := range library {
		if song.ID <= 0 || song.ID > 999999999999999 || seen[song.ID] || len([]rune(strings.TrimSpace(song.Title))) < 1 || len([]rune(song.Title)) > 240 || len([]rune(song.Artist)) > 240 || len(song.Cover) > 2048 || song.Cover != "" && !strings.HasPrefix(song.Cover, "https://") || math.IsNaN(song.Duration) || math.IsInf(song.Duration, 0) || song.Duration < 1 || song.Duration > 86400 {
			return false
		}
		seen[song.ID] = true
	}
	return true
}

func studioTeam(t string) bool { return t == "girls" || t == "boys" }
func oneOf(n int, list ...int) bool {
	for _, v := range list {
		if n == v {
			return true
		}
	}
	return false
}
func validateStudio(s studioSession, t musicTrack, a studioAudio) error {
	if !studioTeam(s.Team) || !oneOf(s.Rounds, 4, 8, 12, 16) || !validStudioProgramme(s.Programme, s.Rounds) || s.Round < 1 || s.Round > s.Rounds || !oneOf(s.AnswerSeconds, 15, 20, 30, 45) || math.Abs(float64(s.Offset)) > 24*3600000 || len(s.History) > s.Round {
		return errors.New("Некоректні налаштування партії.")
	}
	for _, team := range []string{"girls", "boys"} {
		if len([]rune(strings.TrimSpace(s.Names[team]))) < 1 || len([]rune(s.Names[team])) > 32 || s.Scores[team] < 0 || s.Scores[team] > 10000 {
			return errors.New("Перевір назви команд і рахунок.")
		}
	}
	if err := validateStudioTrack(t); err != nil {
		return err
	}
	if s.TrackID != t.ID || s.Target < 0 || len(t.Cues) > 0 && s.Target >= len(t.Cues) || !validStudioAudio(a) {
		return errors.New("Перевір трек і часову шкалу.")
	}
	seen := map[int]bool{}
	for _, h := range s.History {
		if h.Round < 1 || h.Round > s.Round || seen[h.Round] || !studioTeam(h.Team) || h.Awarded != nil && !studioTeam(*h.Awarded) || len(h.Line) > 4000 || len(h.Track) > 1000 {
			return errors.New("Некоректна історія партії.")
		}
		seen[h.Round] = true
	}
	return nil
}
func validateStudioTrack(t musicTrack) error {
	if t.ID <= 0 || len(t.Title) > 500 || len(t.Artist) > 500 || len(t.Cues) > 1500 || t.Duration < 0 || t.Duration > 24*3600 {
		return errors.New("Некоректний трек.")
	}
	for i, c := range t.Cues {
		if c.StartMS < 0 || c.EndMS <= c.StartMS || c.EndMS > 24*3600000 || i > 0 && c.StartMS < t.Cues[i-1].StartMS || len(c.Text) > 4000 || len(c.Words) > 300 {
			return errors.New("Некоректні мітки тексту.")
		}
		for j, w := range c.Words {
			if w.StartMS < c.StartMS || w.EndMS <= w.StartMS || w.EndMS > c.EndMS || j > 0 && w.StartMS < c.Words[j-1].EndMS || len(w.Text) > 1000 {
				return errors.New("Некоректні мітки слів.")
			}
		}
	}
	return nil
}
func validStudioAudio(a studioAudio) bool {
	return a.Volume >= 0 && a.Volume <= 100 && !math.IsNaN(a.Duration) && !math.IsNaN(a.Position) && !math.IsInf(a.Duration, 0) && !math.IsInf(a.Position, 0) && a.Duration >= 0 && a.Duration <= 24*3600 && a.Position >= 0 && a.Position <= a.Duration+.5
}
func (s *studioState) left(now time.Time) int64 {
	if s.Timer.Paused || s.Timer.Deadline == 0 {
		return s.Timer.LeftMS
	}
	return max(int64(0), s.Timer.Deadline-now.UnixMilli())
}
func (s *studioState) pause(now time.Time) {
	s.Audio.Playing = false
	s.Timer.LeftMS = s.left(now)
	s.Timer.Paused = true
	s.Timer.Deadline = 0
}
func (s *studioState) answer(now time.Time) {
	s.Phase = "answer"
	s.Audio.Playing = false
	s.Timer = studioTimer{LeftMS: int64(s.Session.AnswerSeconds) * 1000, Deadline: now.Add(time.Duration(s.Session.AnswerSeconds) * time.Second).UnixMilli()}
}
func (s *studioState) completed() bool {
	for _, r := range s.Session.History {
		if r.Round == s.Session.Round {
			return true
		}
	}
	return false
}
func (s *studioState) stopAt() float64 {
	if s.Session.Target >= len(s.Track.Cues) {
		return -1
	}
	return float64(s.Track.Cues[s.Session.Target].StartMS-s.Session.Offset) / 1000
}

// apply is the single authority for semantic changes. Audio telemetry has no
// permission to award points, edit a team or skip a round.
func (s *studioState) apply(a studioAction, now time.Time, stationReady bool) (*studioInstruction, error) {
	bad := func(message string) (*studioInstruction, error) { return nil, errors.New(message) }
	ins := &studioInstruction{ID: a.ID}
	switch a.Type {
	case "volume":
		if !stationReady || a.Index < 0 || a.Index > 100 {
			return bad("Перевір гучність екрана.")
		}
		s.Audio.Volume = a.Index
		ins.Type = "volume"
		ins.Position = float64(a.Index)
	case "start":
		if s.Phase != "ready" || s.completed() || !s.Session.Aligned || !stationReady || !s.Audio.Ready || s.stopAt() <= .3 || s.stopAt() > s.Audio.Duration-.2 {
			return bad("Спочатку підготуй звук і прив’язку тексту на екрані гри.")
		}
		s.Phase = "playing"
		s.Awarded = nil
		s.Notice = ""
		s.Audio.Position = math.Max(0, s.stopAt()-7)
		s.Audio.Playing = false
		ins.Type = "start"
		ins.Position = s.Audio.Position
	case "music_toggle":
		if !stationReady || !s.Audio.Ready || s.Phase != "ready" && s.Phase != "playing" && s.Phase != "result" {
			return bad("Відтворення зараз недоступне.")
		}
		if s.Audio.Playing {
			ins.Type = "pause"
			s.Audio.Playing = false
		} else {
			ins.Type = "play"
		}
	case "answer":
		if s.Phase != "playing" {
			return bad("Музичний фрагмент ще не запущено.")
		}
		s.answer(now)
		ins.Type = "pause"
	case "timer_toggle":
		if s.Phase != "answer" || s.left(now) == 0 {
			return bad("Відлік зараз недоступний.")
		}
		if s.Timer.Paused {
			s.Timer.Paused = false
			s.Timer.Deadline = now.UnixMilli() + s.Timer.LeftMS
		} else {
			s.Timer.LeftMS = s.left(now)
			s.Timer.Paused = true
			s.Timer.Deadline = 0
		}
	case "award":
		if s.Phase != "answer" || s.completed() || s.Session.Target >= len(s.Track.Cues) || a.Team != nil && !studioTeam(*a.Team) {
			return bad("Цей раунд уже оцінено або ще триває.")
		}
		if a.Team != nil {
			s.Session.Scores[*a.Team] += 3
		}
		s.Awarded = a.Team
		s.Phase = "result"
		s.Audio.Playing = false
		cue := s.Track.Cues[s.Session.Target]
		s.Session.History = append(s.Session.History, studioHistory{Round: s.Session.Round, Team: s.Session.Team, Awarded: a.Team, Track: s.Track.Artist + " · " + s.Track.Title, Line: cue.Text, TrackID: s.Track.ID, Target: s.Session.Target})
		ins.Type = "pause"
	case "undo":
		if s.Phase != "result" || len(s.Session.History) == 0 {
			return bad("Немає оцінки для виправлення.")
		}
		h := s.Session.History[len(s.Session.History)-1]
		if h.Round != s.Session.Round {
			return bad("Можна виправити тільки поточний раунд.")
		}
		if h.Awarded != nil {
			s.Session.Scores[*h.Awarded] = max(0, s.Session.Scores[*h.Awarded]-3)
		}
		s.Session.History = s.Session.History[:len(s.Session.History)-1]
		s.Awarded = nil
		s.answer(now)
	case "next":
		if s.Phase != "result" || !s.completed() {
			return bad("Спочатку оціни відповідь.")
		}
		if s.Session.Round >= s.Session.Rounds {
			s.Phase = "final"
			s.Session.Finished = true
			break
		}
		var nextPrepared int64
		if p := s.Session.Programme; p != nil {
			if !validStudioProgramme(p, s.Session.Rounds) {
				return bad("Перевір програму вечора.")
			}
			if !stationReady {
				return bad("Поверни екран гри в мережу та увімкни звук перед наступною піснею.")
			}
			nextPrepared = p.TrackIDs[s.Session.Round]
			found := false
			for _, song := range s.Library {
				if song.ID == nextPrepared {
					found = true
					break
				}
			}
			if !found {
				return bad("Наступної підготовки немає на пристрої сцени. Віднови її або вимкни програму.")
			}
		}
		s.Session.Round++
		if s.Session.Team == "girls" {
			s.Session.Team = "boys"
		} else {
			s.Session.Team = "girls"
		}
		s.Phase = "ready"
		s.Awarded = nil
		s.Audio.Playing = false
		if nextPrepared > 0 {
			s.Audio.Ready = false
			s.Session.Aligned = false
			s.NeedsTrack = true
			s.Notice = "Готуємо наступну пісню програми…"
			ins.Type = "load_track"
			ins.TrackID = nextPrepared
			ins.Prepared = true
			break
		}
		index := -1
		for step := 1; step <= len(s.Track.Cues); step++ {
			i := (s.Session.Target + step) % len(s.Track.Cues)
			c := s.Track.Cues[i]
			stop := float64(c.StartMS-s.Session.Offset) / 1000
			used := false
			for _, h := range s.Session.History {
				if h.TrackID == s.Track.ID && h.Line == c.Text {
					used = true
				}
			}
			if !used && stop > .3 && stop < s.Audio.Duration-.2 {
				index = i
				break
			}
		}
		s.NeedsTrack = index < 0
		if index >= 0 {
			s.Session.Target = index
		} else {
			s.Session.Aligned = false
			s.Notice = "У цьому фрагменті закінчилися нові рядки. Обери іншу пісню."
		}
		ins.Type = "pause"
	case "new_game":
		if s.Phase != "final" && s.Phase != "result" && s.Phase != "ready" {
			return bad("Заверши поточний фрагмент перед новою грою.")
		}
		s.Session.MatchID = studioSecret()
		s.Session.Programme = nil
		s.Session.Scores = map[string]int{"girls": 0, "boys": 0}
		s.Session.History = []studioHistory{}
		s.Session.Round = 1
		s.Session.Team = "girls"
		s.Session.Finished = false
		s.Phase = "ready"
		s.Awarded = nil
		s.Notice = ""
		s.NeedsTrack = false
		s.Audio.Playing = false
		ins.Type = "pause"
	case "manual_programme":
		if s.Phase != "ready" && s.Phase != "result" {
			return bad("Заверши поточний раунд перед зміною програми.")
		}
		s.Session.Programme = nil
		s.Notice = "Ведучий обирає наступні пісні вручну."
	case "target", "align", "original_timeline", "seek", "load_track", "load_prepared", "config":
		if s.Phase != "ready" {
			return bad("Підготовка доступна перед початком раунду.")
		}
		switch a.Type {
		case "target", "align":
			if a.Index < 0 || a.Index >= len(s.Track.Cues) {
				return bad("Рядок не знайдено.")
			}
			s.Session.Target = a.Index
			if a.Type == "align" {
				s.Session.Offset = s.Track.Cues[a.Index].StartMS - int64(s.Audio.Position*1000)
				s.Session.Aligned = true
				s.Session.Target = min(a.Index+2, len(s.Track.Cues)-1)
			}
			s.NeedsTrack = false
		case "original_timeline":
			if !s.Audio.Local {
				return bad("Ця шкала доступна для власного повного запису.")
			}
			s.Session.Offset = 0
			s.Session.Aligned = true
		case "seek":
			if !stationReady || !s.Audio.Ready || a.Position < 0 || a.Position > s.Audio.Duration {
				return bad("Ця позиція недоступна.")
			}
			ins.Type = "seek"
			ins.Position = a.Position
			s.Audio.Position = a.Position
		case "load_track", "load_prepared":
			if a.TrackID <= 0 || a.TrackID > 999999999999999 {
				return bad("Некоректний трек.")
			}
			if a.Type == "load_prepared" {
				found := false
				for _, song := range s.Library {
					if song.ID == a.TrackID {
						found = true
						break
					}
				}
				if !found {
					return bad("Цієї підготовки вже немає на пристрої сцени.")
				}
				ins.Prepared = true
			}
			if p := s.Session.Programme; p != nil && (a.Type != "load_prepared" || p.TrackIDs[s.Session.Round-1] != a.TrackID) {
				s.Session.Programme = nil
			}
			s.Session.Aligned = false
			s.Audio.Ready = false
			s.Audio.Playing = false
			s.Notice = "Завантажуємо нову пісню…"
			ins.Type = "load_track"
			ins.TrackID = a.TrackID
		case "config":
			c := a.Config
			if c == nil || !oneOf(c.Rounds, 4, 8, 12, 16) || c.Rounds < s.Session.Round || !oneOf(c.AnswerSeconds, 15, 20, 30, 45) {
				return bad("Перевір налаштування партії.")
			}
			if s.Session.Programme != nil && c.Rounds != s.Session.Rounds {
				return bad("Довжину цієї гри визначає програма вечора.")
			}
			for _, t := range []string{"girls", "boys"} {
				if len([]rune(strings.TrimSpace(c.Names[t]))) < 1 || len([]rune(c.Names[t])) > 32 {
					return bad("Назва команди має містити 1–32 символи.")
				}
			}
			s.Session.Names = c.Names
			s.Session.Rounds = c.Rounds
			s.Session.AnswerSeconds = c.AnswerSeconds
			s.Effects = c.Effects
		}
	default:
		return bad("Невідома дія.")
	}
	s.Version++
	if ins.Type == "" {
		return nil, nil
	}
	return ins, nil
}
