package server

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
)

var partyCode = regexp.MustCompile(`^[A-Z2-9]{5}$`)

const partyTTL = 12 * time.Hour

func (h *Hub) restoreParty() {
	if h.dir == "" {
		return
	}
	if err := os.MkdirAll(h.dir, 0700); err != nil {
		log.Printf("party state directory unavailable")
		return
	}
	entries, _ := os.ReadDir(h.dir)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || !partyCode.MatchString(strings.TrimSuffix(entry.Name(), ".json")) || len(h.rooms) >= 200 {
			continue
		}
		info, err := entry.Info()
		if err != nil || info.Size() > 2<<20 {
			continue
		}
		b, err := os.ReadFile(filepath.Join(h.dir, entry.Name()))
		if err != nil {
			continue
		}
		r, err := game.RestoreSnapshot(b)
		if err != nil || r.Code+".json" != entry.Name() || time.Since(r.UpdatedAt) > partyTTL {
			continue
		}
		session := &RoomSession{room: r, clients: map[*Client]bool{}}
		h.rooms[r.Code] = session
		h.archiveParty(session)
	}
}

// Call while holding the room lock so writes cannot overtake newer state.
func (h *Hub) savePartyLocked(s *RoomSession) {
	if h.dir == "" {
		return
	}
	b, err := game.Snapshot(s.room)
	if err != nil {
		log.Printf("party snapshot failed")
		return
	}
	path := filepath.Join(h.dir, s.room.Code+".json")
	temp, err := os.CreateTemp(h.dir, ".party-*")
	if err != nil {
		log.Printf("party state write failed")
		return
	}
	name := temp.Name()
	defer os.Remove(name)
	_ = temp.Chmod(0600)
	if _, err = temp.Write(b); err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	if err != nil {
		log.Printf("party state could not be committed")
	}
}
func (h *Hub) archiveParty(s *RoomSession) {
	if h.db == nil || s.room.Stage != game.StageFinal || s.saved || s.saving {
		return
	}
	s.saving = true
	key, code, winner := s.room.MatchID, s.room.Code, string(game.Winner(s.room))
	config := struct {
		game.RoomConfig
		History []game.RoundSummary `json:"history"`
	}{s.room.Config, append([]game.RoundSummary(nil), s.room.History...)}
	players := []store.MatchPlayer{}
	seen := map[string]bool{}
	for _, p := range s.room.Players {
		if p.UserID != nil {
			if seen[*p.UserID] {
				continue
			}
			seen[*p.UserID] = true
		}
		players = append(players, store.MatchPlayer{UserID: p.UserID, Name: p.Name, Team: string(p.Team), Score: s.room.Teams[p.Team].Score})
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := h.db.SaveMatch(ctx, code, config, winner, players, key)
		s.mu.Lock()
		defer s.mu.Unlock()
		s.saving = false
		if s.room.MatchID != key {
			h.archiveParty(s)
			return
		}
		if err == nil {
			s.saved = true
			return
		}
		log.Printf("party history save failed; will retry")
		time.AfterFunc(5*time.Second, func() { s.mu.Lock(); defer s.mu.Unlock(); h.archiveParty(s) })
	}()
}
func (h *Hub) persist(s *RoomSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h.savePartyLocked(s)
	if h.cache != nil {
		b, _ := json.Marshal(game.BuildView(s.room, nil))
		code := s.room.Code
		go h.cache.SaveRoomSnapshot(context.Background(), code, b, 3*time.Hour)
	}
}
