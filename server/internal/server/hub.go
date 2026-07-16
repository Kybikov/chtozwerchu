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
	mu      sync.Mutex
	room    *game.Room
	clients map[*Client]bool
	saved   bool // whether the finished match has been persisted
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
	h.persist(s)
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
	s.mu.Unlock()
	c.enqueue(you)
	for _, m := range msgs {
		m.c.enqueue(m.b)
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
