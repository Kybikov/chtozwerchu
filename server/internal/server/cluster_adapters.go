package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chtozverchu/internal/game"
)

func (s *RoomSession) commitCluster() bool {
	if s.lost {
		return false
	}
	if s.cluster == nil {
		s.committed = true
		return true
	}
	body, err := game.Snapshot(s.room)
	if err == nil {
		err = s.cluster.commit(s.binding, body, partyTTL)
	}
	s.committed = err == nil
	if err != nil {
		s.lost = true
		go s.cluster.lose(s.binding)
	}
	return err == nil
}

// Out-of-order producers must not make a client regress to an older round.
// This applies to the original direct transport as well as the Redis relay.
func freshPartyMessage(body []byte, last *uint64) bool {
	var m struct {
		Type          string `json:"type"`
		Revision      uint64 `json:"revision"`
		StateRevision uint64 `json:"stateRevision"`
	}
	if json.Unmarshal(body, &m) != nil {
		return true
	}
	if m.Type == "state" && m.Revision > 0 {
		if m.Revision <= *last {
			return false
		}
		*last = m.Revision
	}
	if m.Type == "media_clock" && m.StateRevision > 0 && m.StateRevision != *last {
		return false
	}
	return true
}

func (h *Hub) restoreClusterRoom(b roomBinding, body []byte) error {
	r, err := game.RestoreSnapshot(body)
	if err != nil || r.Code != b.Code || time.Since(r.UpdatedAt) > partyTTL {
		return errRoomMissing
	}
	s := &RoomSession{room: r, clients: map[*Client]bool{}, cluster: h.cluster, binding: b}
	if !s.commitCluster() {
		return errClusterUnavailable
	}
	h.mu.Lock()
	h.rooms[b.Code] = s
	h.mu.Unlock()
	return nil
}
func (h *Hub) suspendClusterRoom(b roomBinding) {
	h.mu.Lock()
	s := h.rooms[b.Code]
	if s == nil || s.binding != b {
		h.mu.Unlock()
		return
	}
	delete(h.rooms, b.Code)
	h.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lost = true
	s.committed = false
	h.engine.Pause(s.room)
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	if s.mediaTimer != nil {
		s.mediaTimer.Stop()
		s.mediaTimer = nil
	}
	if s.checkpoint != nil {
		s.checkpoint.Stop()
		s.checkpoint = nil
	}
	for client := range s.clients {
		delete(s.clients, client)
		client.conn.Close()
	}
}

func resetRestoredStudio(room *studioRoom) {
	if !validStudioLibrary(room.State.Library) {
		room.State.Library = nil
	}
	room.clients = map[*studioPeer]bool{}
	room.seen = map[string]bool{}
	room.State.Audio.Playing = false
	room.State.Audio.Ready = false
	room.State.Timer.Paused = true
	room.State.Timer.Deadline = 0
	if room.State.Session.MatchID == "" {
		room.State.Session.MatchID = studioSecret()
	}
	room.State.Notice = "Сервер відновив гру. Увімкни звук на екрані й продовжуй."
	room.State.Version++
}
func (h *studioHub) restoreClusterRoom(b roomBinding, body []byte) error {
	var room studioRoom
	if json.Unmarshal(body, &room) != nil || room.Code != b.Code || room.Expires <= time.Now().UnixMilli() || validateStudio(room.State.Session, room.State.Track, room.State.Audio) != nil {
		return errRoomMissing
	}
	resetRestoredStudio(&room)
	room.binding = b
	if err := h.save(&room); err != nil {
		return err
	}
	h.mu.Lock()
	h.rooms[b.Code] = &room
	h.mu.Unlock()
	return nil
}
func (h *studioHub) suspendClusterRoom(b roomBinding) {
	h.mu.Lock()
	room := h.rooms[b.Code]
	if room == nil || room.binding != b {
		h.mu.Unlock()
		return
	}
	delete(h.rooms, b.Code)
	h.mu.Unlock()
	room.mu.Lock()
	defer room.mu.Unlock()
	room.lost = true
	room.State.pause(time.Now())
	for p := range room.clients {
		delete(room.clients, p)
		p.close()
	}
}

type clusterResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *clusterResponse) Header() http.Header {
	if r.header == nil {
		r.header = http.Header{}
	}
	return r.header
}
func (r *clusterResponse) WriteHeader(status int) { r.status = status }
func (r *clusterResponse) Write(body []byte) (int, error) {
	if r.status == 0 {
		r.status = 200
	}
	return r.body.Write(body)
}

func (s *Server) setupRoomCluster() {
	s.studio = loadStudioHub(os.Getenv("STUDIO_STATE_DIR"), s.db)
	defer func() { go s.studio.tick() }()
	s.studio.owner = s.userFromRequest
	if s.cfg.RedisURL == "" || s.hub.cache == nil {
		return
	}
	prefix := os.Getenv("ROOM_CLUSTER_NAMESPACE")
	if prefix == "" {
		prefix = "khz:rooms:v1"
	}
	hooks := clusterHooks{
		restore: func(b roomBinding, body []byte) error {
			if b.Kind == "party" {
				return s.hub.restoreClusterRoom(b, body)
			}
			return s.studio.restoreClusterRoom(b, body)
		},
		suspend: func(b roomBinding) {
			if b.Kind == "party" {
				s.hub.suspendClusterRoom(b)
			} else {
				s.studio.suspendClusterRoom(b)
			}
		},
		accept: func(kind string, conn roomConnection, cookie string) {
			if kind == "party" {
				s.hub.acceptClusterConnection(conn, cookie)
			} else {
				s.studio.acceptConnection(conn)
			}
		},
		end: func(ctx context.Context, b roomBinding, authorization string) (int, []byte) {
			r, _ := http.NewRequestWithContext(ctx, http.MethodDelete, "http://internal/api/studio/rooms/"+b.Code, nil)
			r.SetPathValue("code", b.Code)
			r.Header.Set("Authorization", authorization)
			w := &clusterResponse{}
			s.studio.endBound(w, r, &b)
			return w.status, w.body.Bytes()
		},
	}
	c, err := newRoomCluster(s.hub.cache.RedisClient(), prefix, 0, hooks)
	if err != nil {
		log.Printf("room coordinator unavailable; network rooms disabled")
		return
	}
	// Import a legacy volume once per namespace. Later file backups are never
	// auto-imported: an old node must not resurrect a closed/expired Redis room.
	var markers []string
	bootstrap := map[string]bool{}
	for kind, dir := range map[string]string{"party": s.hub.dir, "studio": s.studio.dir} {
		if dir == "" {
			continue
		}
		hash := sha256.Sum256([]byte(prefix))
		marker := filepath.Join(dir, fmt.Sprintf(".redis-bootstrap-%x", hash[:8]))
		if _, e := os.Stat(marker); errors.Is(e, os.ErrNotExist) {
			bootstrap[kind] = true
			markers = append(markers, marker)
		} else if e != nil {
			err = e
			break
		}
	}
	if err != nil {
		c.close()
		log.Printf("room migration marker unavailable; network rooms disabled")
		return
	}
	s.hub.mu.Lock()
	partyRooms := make(map[string]*RoomSession, len(s.hub.rooms))
	for code, room := range s.hub.rooms {
		partyRooms[code] = room
	}
	s.hub.mu.Unlock()
	for code, room := range partyRooms {
		if !bootstrap["party"] {
			break
		}
		room.mu.Lock()
		body, e := game.Snapshot(room.room)
		ttl := partyTTL - time.Since(room.room.UpdatedAt)
		room.mu.Unlock()
		if e == nil && ttl > 0 {
			err = c.importSnapshot("party", code, body, ttl)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		s.hub.mu.Lock()
		s.hub.rooms = map[string]*RoomSession{}
		s.hub.mu.Unlock()
	}
	if err == nil {
		s.studio.mu.Lock()
		studioRooms := make(map[string]*studioRoom, len(s.studio.rooms))
		for code, room := range s.studio.rooms {
			studioRooms[code] = room
		}
		s.studio.mu.Unlock()
		for code, room := range studioRooms {
			if !bootstrap["studio"] {
				break
			}
			room.mu.Lock()
			body, e := json.Marshal(room)
			ttl := time.Until(time.UnixMilli(room.Expires))
			room.mu.Unlock()
			if e == nil && ttl > 0 {
				err = c.importSnapshot("studio", code, body, ttl)
				if err != nil {
					break
				}
			}
		}
		if err == nil {
			s.studio.mu.Lock()
			s.studio.rooms = map[string]*studioRoom{}
			s.studio.mu.Unlock()
		}
	}
	if err == nil {
		for _, marker := range markers {
			f, e := os.OpenFile(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if errors.Is(e, os.ErrExist) {
				continue
			}
			if e != nil {
				err = e
				break
			}
			_, err = f.WriteString("Canonical room state is in Redis; restore file backups explicitly.\n")
			if err == nil {
				err = f.Sync()
			}
			closeErr := f.Close()
			if err == nil {
				err = closeErr
			}
			if err != nil {
				_ = os.Remove(marker)
				break
			}
		}
	}
	if err != nil {
		c.close()
		log.Printf("room snapshot migration failed; network rooms disabled")
		return
	}
	s.cluster = c
	s.hub.cluster = c
	s.studio.cluster = c
}

func (s *Server) Close() {
	s.closeOnce.Do(func() {
		if s.cluster != nil {
			s.cluster.close()
		}
		if s.studio != nil {
			s.studio.close()
		}
	})
}

func (c *roomCluster) discardNew(b roomBinding) {
	c.mu.Lock()
	if owned := c.owned[c.key(b)]; owned != nil && owned.binding == b {
		delete(c.owned, c.key(b))
	}
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = c.rdb.Eval(ctx, `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1],KEYS[2]) end return 0`, []string{c.ownerKey(b), c.stateKey(b)}, b.Epoch).Err()
}
