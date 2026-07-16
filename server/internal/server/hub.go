package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"chtozverchu/internal/auth"
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
)

// Hub owns all live room sessions on this instance.
type Hub struct {
	engine *game.Engine
	cache  *store.Cache // optional (nil disables snapshots)
	db     *store.DB    // optional (nil disables accounts/history)
	secret string       // token secret for resolving authenticated players

	mu    sync.Mutex
	rooms map[string]*RoomSession
	up    websocket.Upgrader
}

// RoomSession binds a game room to the clients watching it.
type RoomSession struct {
	mu       sync.Mutex
	room     *game.Room
	clients  map[*Client]bool
	saved      bool        // whether the finished match has been persisted
	timer      *time.Timer // countdown for timed rounds
	timerKey   int         // round index the timer is armed for
	previewKey int         // round index a melody preview lookup was started for
}

type clientMsg struct {
	c *Client
	b []byte
}

// NewHub builds a hub.
func NewHub(engine *game.Engine, cache *store.Cache, db *store.DB, secret string) *Hub {
	return &Hub{
		engine: engine,
		cache:  cache,
		db:     db,
		secret: secret,
		rooms:  map[string]*RoomSession{},
		up: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(*http.Request) bool { return true },
		},
	}
}

// ServeWS upgrades an HTTP request to a WebSocket connection.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, sendBuffer)}
	go c.writePump()
	go c.readPump()
}

func (h *Hub) handleMessage(c *Client, data []byte) {
	var m inMsg
	if err := json.Unmarshal(data, &m); err != nil {
		c.enqueue(errorMsg("некоректне повідомлення"))
		return
	}
	switch m.Type {
	case "create_room":
		h.createRoom(c, m.Payload)
	case "join":
		h.joinRoom(c, m.Payload)
	case "start_game":
		h.hostAction(c, func(s *RoomSession) error { return h.engine.StartGame(s.room) })
	case "set_config":
		h.setConfig(c, m.Payload)
	case "set_team":
		h.setTeam(c, m.Payload)
	case "action":
		h.doAction(c, m.Payload)
	case "leave":
		h.disconnect(c)
	default:
		c.enqueue(errorMsg("невідомий тип повідомлення"))
	}
}

func (h *Hub) createRoom(c *Client, payload json.RawMessage) {
	var p createPayload
	_ = json.Unmarshal(payload, &p)
	userID, displayName := h.resolveUser(p.AuthToken)
	if p.HostName == "" && displayName != "" {
		p.HostName = displayName
	}
	room, host := h.engine.CreateRoom(game.CreateParams{
		HostName:   p.HostName,
		HostTeam:   p.HostTeam,
		GirlsName:  p.GirlsName,
		BoysName:   p.BoysName,
		Rounds:     p.Rounds,
		RoundTypes: p.RoundTypes,
		Preset:     p.Preset,
		UserID:     userID,
	})
	s := &RoomSession{room: room, clients: map[*Client]bool{}}
	h.mu.Lock()
	h.rooms[room.Code] = s
	h.mu.Unlock()
	h.attach(c, s, host)
}

func (h *Hub) joinRoom(c *Client, payload json.RawMessage) {
	var p joinPayload
	_ = json.Unmarshal(payload, &p)
	code := strings.ToUpper(strings.TrimSpace(p.Code))
	s := h.session(code)
	if s == nil {
		c.enqueue(errorMsg("кімнату не знайдено"))
		return
	}
	userID, displayName := h.resolveUser(p.AuthToken)
	name := p.Name
	if name == "" && displayName != "" {
		name = displayName
	}
	s.mu.Lock()
	player, err := h.engine.Join(s.room, name, p.Team, p.Token)
	if err == nil && userID != nil {
		player.UserID = userID
	}
	s.mu.Unlock()
	if err != nil {
		c.enqueue(errorMsg(err.Error()))
		return
	}
	h.attach(c, s, player)
}

func (h *Hub) setConfig(c *Client, payload json.RawMessage) {
	if !h.isHost(c) {
		c.enqueue(errorMsg("тільки ведучий може змінювати налаштування"))
		return
	}
	var p configPayload
	_ = json.Unmarshal(payload, &p)
	h.mutate(c, func(s *RoomSession) error {
		h.engine.SetConfig(s.room, p.Rounds, p.RoundTypes, p.Preset)
		return nil
	})
}

func (h *Hub) setTeam(c *Client, payload json.RawMessage) {
	if c.session == nil || c.player == nil {
		return
	}
	var p setTeamPayload
	_ = json.Unmarshal(payload, &p)
	h.mutate(c, func(s *RoomSession) error {
		h.engine.SetPlayerTeam(s.room, c.player, p.Team)
		return nil
	})
}

func (h *Hub) doAction(c *Client, payload json.RawMessage) {
	if c.session == nil || c.player == nil {
		c.enqueue(errorMsg("спершу приєднайтесь до кімнати"))
		return
	}
	var p actionPayload
	_ = json.Unmarshal(payload, &p)
	h.mutate(c, func(s *RoomSession) error {
		return h.engine.Apply(s.room, game.Action{
			Name:    p.Name,
			Actor:   c.player,
			IsHost:  c.player.IsHost,
			Payload: p.Payload,
		})
	})
}

func (h *Hub) hostAction(c *Client, fn func(*RoomSession) error) {
	if !h.isHost(c) {
		c.enqueue(errorMsg("тільки ведучий може це робити"))
		return
	}
	h.mutate(c, fn)
}

// mutate applies fn under the session lock and broadcasts the new state.
func (h *Hub) mutate(c *Client, fn func(*RoomSession) error) {
	s := c.session
	if s == nil {
		c.enqueue(errorMsg("немає активної кімнати"))
		return
	}
	s.mu.Lock()
	err := fn(s)
	var msgs []clientMsg
	var toSave *game.Room
	if err == nil {
		msgs = s.renderAll()
		if s.room.Stage == game.StageFinal && !s.saved {
			s.saved = true
			toSave = s.room
		} else if s.room.Stage != game.StageFinal {
			s.saved = false
		}
		h.armTimer(s)
	}
	pNeed, pKey, pTitle, pArtist := false, 0, "", ""
	if err == nil {
		pNeed, pKey, pTitle, pArtist = h.previewRequest(s)
	}
	s.mu.Unlock()
	if err != nil {
		c.enqueue(errorMsg(err.Error()))
		return
	}
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
	if toSave != nil {
		h.persistMatch(toSave)
	}
	if pNeed {
		go h.resolvePreview(s, pKey, pTitle, pArtist)
	}
	h.persist(s)
}

// armTimer schedules (or clears) the round countdown. Caller holds s.mu.
func (h *Hub) armTimer(s *RoomSession) {
	r := s.room
	timed := r.Stage == game.StagePlaying && r.Current != nil && !r.Current.Deadline.IsZero()
	if !timed {
		if s.timer != nil {
			s.timer.Stop()
			s.timer = nil
		}
		s.timerKey = 0
		return
	}
	if s.timer != nil && s.timerKey == r.RoundIndex {
		return // already armed for this round
	}
	if s.timer != nil {
		s.timer.Stop()
	}
	key := r.RoundIndex
	s.timerKey = key
	d := time.Until(r.Current.Deadline)
	if d < 0 {
		d = 0
	}
	s.timer = time.AfterFunc(d, func() { h.fireTimeout(s, key) })
}

// fireTimeout resolves a timed round when its deadline passes.
func (h *Hub) fireTimeout(s *RoomSession, key int) {
	s.mu.Lock()
	if s.room.RoundIndex != key || s.room.Stage != game.StagePlaying {
		s.mu.Unlock()
		return
	}
	h.engine.Timeout(s.room)
	msgs := s.renderAll()
	s.mu.Unlock()
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
	h.persist(s)
}

// previewRequest returns a melody preview lookup to perform, if any. Caller
// holds s.mu.
func (h *Hub) previewRequest(s *RoomSession) (bool, int, string, string) {
	title, artist, ok := game.MelodyPreviewNeeded(s.room)
	if !ok || s.previewKey == s.room.RoundIndex {
		return false, 0, "", ""
	}
	s.previewKey = s.room.RoundIndex
	return true, s.room.RoundIndex, title, artist
}

// resolvePreview fetches a Deezer preview and pushes it to clients when ready.
func (h *Hub) resolvePreview(s *RoomSession, key int, title, artist string) {
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	previewURL, err := store.DeezerPreview(ctx, title, artist)
	if err != nil || previewURL == "" {
		return
	}
	s.mu.Lock()
	var msgs []clientMsg
	if s.room.RoundIndex == key && game.SetMelodyPreview(s.room, previewURL) {
		msgs = s.renderAll()
	}
	s.mu.Unlock()
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
}

// resolveUser maps an auth token to a user id and display name.
func (h *Hub) resolveUser(token string) (*string, string) {
	if token == "" || h.db == nil {
		return nil, ""
	}
	id, err := auth.Verify(h.secret, token)
	if err != nil {
		return nil, ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	u, err := h.db.UserByID(ctx, id)
	if err != nil {
		return nil, ""
	}
	return &u.ID, u.DisplayName
}

// persistMatch writes a finished match and its players to Postgres.
func (h *Hub) persistMatch(room *game.Room) {
	if h.db == nil {
		return
	}
	players := make([]store.MatchPlayer, 0, len(room.Players))
	for _, p := range room.Players {
		players = append(players, store.MatchPlayer{
			UserID: p.UserID,
			Name:   p.Name,
			Team:   string(p.Team),
			Score:  room.Teams[p.Team].Score,
		})
	}
	winner := string(game.Winner(room))
	code := room.Code
	cfg := room.Config
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.db.SaveMatch(ctx, code, cfg, winner, players); err != nil {
			log.Printf("save match %s: %v", code, err)
		}
	}()
}

func (h *Hub) attach(c *Client, s *RoomSession, p *game.Player) {
	c.session = s
	c.player = p
	s.mu.Lock()
	s.clients[c] = true
	p.Connected = true
	you := youAre(p, s.room.Code)
	msgs := s.renderAll()
	h.armTimer(s)
	pNeed, pKey, pTitle, pArtist := h.previewRequest(s)
	s.mu.Unlock()
	c.enqueue(you)
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
	if pNeed {
		go h.resolvePreview(s, pKey, pTitle, pArtist)
	}
	h.persist(s)
}

func (h *Hub) disconnect(c *Client) {
	s := c.session
	if s == nil {
		return
	}
	c.session = nil
	s.mu.Lock()
	delete(s.clients, c)
	if c.player != nil {
		stillHere := false
		for cl := range s.clients {
			if cl.player == c.player {
				stillHere = true
				break
			}
		}
		if !stillHere {
			c.player.Connected = false
		}
	}
	msgs := s.renderAll()
	empty := len(s.clients) == 0
	code := s.room.Code
	s.mu.Unlock()
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
	if empty {
		h.scheduleCleanup(code)
	}
}

// renderAll builds a per-viewer state message for every client. Caller holds s.mu.
func (s *RoomSession) renderAll() []clientMsg {
	msgs := make([]clientMsg, 0, len(s.clients))
	for c := range s.clients {
		view := game.BuildView(s.room, c.player)
		msgs = append(msgs, clientMsg{c: c, b: stateMsg(view)})
	}
	return msgs
}

func (h *Hub) isHost(c *Client) bool {
	return c.session != nil && c.player != nil && c.player.IsHost
}

func (h *Hub) session(code string) *RoomSession {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

func (h *Hub) scheduleCleanup(code string) {
	time.AfterFunc(10*time.Minute, func() {
		h.mu.Lock()
		s := h.rooms[code]
		if s != nil {
			s.mu.Lock()
			empty := len(s.clients) == 0
			s.mu.Unlock()
			if empty {
				delete(h.rooms, code)
			}
		}
		h.mu.Unlock()
		if h.cache != nil {
			h.cache.DeleteRoom(context.Background(), code)
		}
	})
}

func (h *Hub) persist(s *RoomSession) {
	if h.cache == nil {
		return
	}
	s.mu.Lock()
	view := game.BuildView(s.room, nil)
	code := s.room.Code
	s.mu.Unlock()
	b, _ := json.Marshal(view)
	go h.cache.SaveRoomSnapshot(context.Background(), code, b, 3*time.Hour)
}

func youAre(p *game.Player, code string) []byte {
	b, _ := json.Marshal(youAreMsg{
		Type:     "you_are",
		PlayerID: p.ID,
		Token:    p.Token,
		Code:     code,
		Host:     p.IsHost,
	})
	return b
}
