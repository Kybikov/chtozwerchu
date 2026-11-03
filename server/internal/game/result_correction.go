package game

import (
	"errors"
	"math"
)

// A correction changes the award, never replays an already revealed answer.
func correctionLimit(room *Room) int {
	if room.Current == nil {
		return 0
	}
	if r := room.Current.Result; r != nil && r.AwardLimit > 0 {
		return r.AwardLimit
	}
	switch d := room.Current.Data.(type) {
	case *fiveWordsData:
		return fiveWordsPoints(d)
	case *melodyData:
		return min(3, max(1, melodyMaxPoints-d.Hints))
	case *aliasData:
		return len(d.Cards)
	case *crocodileData:
		return crocodilePoints(d)
	case *truthLieData:
		return 2
	}
	return 0
}

func correctionInt(a Action, key string) (int, bool) {
	switch n := a.Payload[key].(type) {
	case int:
		return n, true
	case float64:
		if !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) && n >= 0 && n <= math.MaxInt32 {
			return int(n), true
		}
	}
	return 0, false
}

func amendResult(room *Room, act Action) error {
	if !act.IsHost {
		return ErrNotHost
	}
	if room.Stage != StageResult || room.Current == nil || room.Current.Result == nil {
		return ErrBadStage
	}
	if act.Round < 1 || act.Round != room.RoundIndex {
		return errors.New("Конкурс уже змінився. Перевір результат.")
	}
	result := room.Current.Result
	revision, ok := correctionInt(act, "revision")
	if !ok || revision != result.CorrectionRevision {
		return errors.New("Оцінку вже змінено. Перевір актуальні бали.")
	}
	team := Team(act.Str("team"))
	points, ok := correctionInt(act, "points")
	limit := correctionLimit(room)
	if !team.Valid() || !ok || points < 0 || points > limit {
		return errors.New("Обери команду та бали в межах цього конкурсу.")
	}
	oldTeam := room.Teams[result.Team]
	if oldTeam == nil || room.Teams[team] == nil || result.Points < 0 || oldTeam.Score < result.Points {
		return errors.New("Не вдалося звірити рахунок конкурсу.")
	}
	if result.Team == team && result.Points == points {
		return nil
	}
	if result.OriginalAward == nil {
		result.OriginalAward = &RoundAward{Team: result.Team, Points: result.Points}
	}
	oldTeam.Score -= result.Points
	room.Teams[team].Score += points
	result.Team, result.Points, result.Won = team, points, points > 0
	result.AwardLimit = limit
	result.CorrectionRevision++
	room.StopMedia()
	room.touch()
	return nil
}
