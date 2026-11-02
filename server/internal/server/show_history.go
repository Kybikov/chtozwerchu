package server

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"time"
)

var showKey = regexp.MustCompile(`^[A-Za-z0-9_-]{20,80}$`)

func validFinishedShow(s studioSession) bool {
	if !showKey.MatchString(s.MatchID) || !s.Finished || s.Round != s.Rounds || !oneOf(s.Rounds, 4, 8, 12, 16) || len(s.History) != s.Rounds {
		return false
	}
	for _, team := range []string{"girls", "boys"} {
		if len([]rune(s.Names[team])) < 1 || len([]rune(s.Names[team])) > 32 || s.Scores[team] < 0 || s.Scores[team] > 10000 {
			return false
		}
	}
	for i, r := range s.History {
		if r.Round != i+1 || !studioTeam(r.Team) || r.Awarded != nil && !studioTeam(*r.Awarded) || len(r.Line) > 4000 || len(r.Track) > 1000 {
			return false
		}
	}
	return true
}
func (s *Server) showHistory(w http.ResponseWriter, r *http.Request) {
	authNoCache(w)
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, 401, errBody("Увійди, щоб переглянути свої музичні ігри."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	items, err := s.db.StudioHistory(ctx, user.ID)
	if err != nil {
		writeJSON(w, 503, errBody("Не вдалося завантажити музичну історію."))
		return
	}
	writeJSON(w, 200, map[string]any{"shows": items})
}
func (s *Server) saveLocalShow(w http.ResponseWriter, r *http.Request) {
	authNoCache(w)
	if !studioOrigin(r) {
		writeJSON(w, 403, errBody("Недозволене джерело запиту."))
		return
	}
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, 401, errBody("Увійди, щоб зберегти гру у профілі."))
		return
	}
	var input struct {
		Session studioSession `json:"session"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&input) != nil || !validFinishedShow(input.Session) {
		writeJSON(w, 400, errBody("Зберегти можна завершену партію з усіма результатами."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if err := s.db.SaveStudioMatch(ctx, user.ID, input.Session.MatchID, "", "local", input.Session); err != nil {
		writeJSON(w, 503, errBody("Гра залишилася на пристрої. Збереження у профіль можна повторити."))
		return
	}
	writeJSON(w, 200, map[string]bool{"saved": true})
}

// Called with the room locked. A stable match key makes the database write
// idempotent across transport retries and a process restart.
func (h *studioHub) archive(room *studioRoom) {
	if room.lost || h.cluster != nil && !h.cluster.owns(room.binding) {
		return
	}
	if h.db == nil || room.OwnerID == "" || room.State.Phase != "final" || room.ArchivedKey == room.State.Session.MatchID || room.historySaving || time.Since(room.historyAttempt) < 5*time.Second {
		return
	}
	if !validFinishedShow(room.State.Session) {
		return
	}
	room.historySaving = true
	room.historyAttempt = time.Now()
	owner, key, code := room.OwnerID, room.State.Session.MatchID, room.Code
	snapshot, _ := json.Marshal(room.State.Session)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := h.db.SaveStudioMatch(ctx, owner, key, code, "network", json.RawMessage(snapshot))
		room.mu.Lock()
		defer room.mu.Unlock()
		room.historySaving = false
		if err == nil && room.State.Session.MatchID == key {
			room.ArchivedKey = key
			_ = h.save(room)
		}
	}()
}
