package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
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
	dir    string

	mu    sync.Mutex
	rooms map[string]*RoomSession
	up    websocket.Upgrader
}

// RoomSession binds a game room to the clients watching it.
type RoomSession struct {
	mediaLast      time.Time
	mediaRequested time.Time
	mediaProgress  time.Time
	mediaClock     time.Time
	mediaTimer     *time.Timer
	mu             sync.Mutex
	room           *game.Room
	clients        map[*Client]bool
	saved          bool // whether the finished match has been persisted
	saving         bool
	timer          *time.Timer // countdown for timed rounds
	timerKey       int         // round index the timer is armed for
	timerDeadline  time.Time   // deadlines can change within a buzzer round
	previewKey     int         // round index a melody preview lookup was started for
	chatLog        []chatOut   // recent chat, capped
}

const chatHistoryLimit = 30

type clientMsg struct {
	c *Client
	b []byte
}

// NewHub builds a hub.
func NewHub(engine *game.Engine, cache *store.Cache, db *store.DB, secret string) *Hub {
	h := &Hub{
		engine: engine,
		cache:  cache,
		db:     db,
		secret: secret,
		dir:    os.Getenv("PARTY_STATE_DIR"),
		rooms:  map[string]*RoomSession{},
		up: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     studioOrigin,
		},
	}
	h.restoreParty()
	return h
}

// ServeWS upgrades an HTTP request to a WebSocket connection.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, sendBuffer)}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		c.userID, c.displayName = h.resolveUser(cookie.Value)
	}
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
	case "ping":
		c.enqueue([]byte(`{"type":"pong"}`))
	case "create_room":
		h.createRoom(c, m.Payload)
	case "join":
		h.joinRoom(c, m.Payload)
	case "watch":
		h.watchRoom(c, m.Payload)
	case "media_status":
		h.receiveMedia(c, m.Payload)
	case "start_game":
		h.hostAction(c, func(s *RoomSession) error { return h.engine.StartGame(s.room) })
	case "set_config":
		h.setConfig(c, m.Payload)
	case "set_team":
		h.setTeam(c, m.Payload)
	case "action":
		h.doAction(c, m.Payload)
	case "chat":
		h.chat(c, m.Payload)
	case "leave":
		h.disconnect(c)
	default:
		c.enqueue(errorMsg("невідомий тип повідомлення"))
	}
}

func (h *Hub) createRoom(c *Client, payload json.RawMessage) {
	if c.session != nil {
		h.disconnect(c)
	}
	var p createPayload
	_ = json.Unmarshal(payload, &p)
	c.protocol = p.Protocol
	c.mediaSupported = p.Protocol >= 2
	c.partyTV = false
	if p.MelodyMode == "buzzer" && p.Protocol < 3 {
		c.enqueue(errorMsg("Онови застосунок, щоб створити гру з кнопкою «Знаю пісню»."))
		return
	}
	userID, displayName := h.resolveUser(p.AuthToken)
	if userID == nil && p.AuthToken == "" {
		userID, displayName = c.userID, c.displayName
	}
	if len([]rune(p.HostName)) > 32 || len([]rune(p.GirlsName)) > 32 || len([]rune(p.BoysName)) > 32 {
		c.enqueue(errorMsg("Назви мають містити не більше 32 символів."))
		return
	}
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
		VoteMode:   p.VoteMode,
		MelodyMode: p.MelodyMode,
	})
	s := &RoomSession{room: room, clients: map[*Client]bool{}}
	h.mu.Lock()
	if len(h.rooms) >= 200 || h.rooms[room.Code] != nil {
		h.mu.Unlock()
		c.enqueue(errorMsg("Зараз багато ігор. Спробуй створити кімнату трохи пізніше."))
		return
	}
	h.rooms[room.Code] = s
	h.mu.Unlock()
	h.attach(c, s, host)
}

func (h *Hub) joinRoom(c *Client, payload json.RawMessage) {
	if c.session != nil {
		h.disconnect(c)
	}
	var p joinPayload
	_ = json.Unmarshal(payload, &p)
	c.protocol = p.Protocol
	c.mediaSupported = p.Protocol >= 2
	c.partyTV = false
	code := strings.ToUpper(strings.TrimSpace(p.Code))
	s := h.session(code)
	if s == nil {
		c.enqueue(errorMsg("кімнату не знайдено"))
		return
	}
	userID, displayName := h.resolveUser(p.AuthToken)
	if userID == nil && p.AuthToken == "" {
		userID, displayName = c.userID, c.displayName
	}
	if len([]rune(p.Name)) > 32 {
		c.enqueue(errorMsg("Ім’я має містити не більше 32 символів."))
		return
	}
	name := p.Name
	if name == "" && displayName != "" {
		name = displayName
	}
	s.mu.Lock()
	if s.room.Config.MelodyMode == "buzzer" && p.Protocol < 3 {
		s.mu.Unlock()
		c.enqueue(errorMsg("У цій кімнаті грають із кнопкою «Знаю пісню». Онови застосунок і приєднайся знову."))
		return
	}
	if len(s.clients) >= 64 {
		s.mu.Unlock()
		c.enqueue(errorMsg("У кімнаті забагато підключень."))
		return
	}
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
		if p.MelodyMode == "buzzer" {
			for peer := range s.clients {
				if (peer.player != nil || peer.partyTV) && peer.protocol < 3 {
					return errors.New("Для гри наввипередки учасникам і TV потрібно оновити застосунок.")
				}
			}
		}
		h.engine.SetConfig(s.room, p.Rounds, p.RoundTypes, p.Preset, p.VoteMode, p.MelodyMode)
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

func (h *Hub) chat(c *Client, payload json.RawMessage) {
	if c.session == nil || c.player == nil {
		return
	}
	var p chatPayload
	_ = json.Unmarshal(payload, &p)
	text := strings.TrimSpace(p.Text)
	if text == "" {
		return
	}
	if len([]rune(text)) > 300 {
		text = string([]rune(text)[:300])
	}
	msg := chatOut{Type: "chat", From: c.player.Name, Team: c.player.Team, Text: text, TS: time.Now().UnixMilli()}
	s := c.session
	s.mu.Lock()
	s.chatLog = append(s.chatLog, msg)
	if len(s.chatLog) > chatHistoryLimit {
		s.chatLog = s.chatLog[len(s.chatLog)-chatHistoryLimit:]
	}
	clients := make([]*Client, 0, len(s.clients))
	for cl := range s.clients {
		clients = append(clients, cl)
	}
	s.mu.Unlock()
	b, _ := json.Marshal(msg)
	for _, cl := range clients {
		cl.enqueue(b)
	}
}

func (h *Hub) doAction(c *Client, payload json.RawMessage) {
	if c.session == nil || c.player == nil {
		c.enqueue(errorMsg("спершу приєднайтесь до кімнати"))
		return
	}
	var p actionPayload
	_ = json.Unmarshal(payload, &p)
	h.mutate(c, func(s *RoomSession) error {
		if p.Round != 0 && p.Round != s.room.RoundIndex {
			return errors.New("Раунд уже змінився. Перевір екран.")
		}
		if p.CardIndex != nil && s.room.Current != nil && s.room.Current.Type == game.RoundAlias {
			view := game.BuildView(s.room, c.player)
			if round, ok := view.Round.(map[string]any); ok && round["index"] != *p.CardIndex {
				return errors.New("Цю картку вже завершено.")
			}
		}
		if handled, err := h.mediaAction(s, c, p); handled {
			return err
		}
		return h.engine.Apply(s.room, game.Action{
			// The React client includes the round and card to reject delayed clicks.
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
	if !s.clients[c] {
		s.mu.Unlock()
		c.enqueue(errorMsg("Це підключення вже замінено. Відкрий кімнату заново."))
		return
	}
	err := fn(s)
	var msgs []clientMsg
	if err == nil {
		msgs = s.renderAll()
		if s.room.Stage != game.StageFinal {
			s.saved = false
		}
		h.archiveParty(s)
		h.armTimer(s)
		h.armMediaWatchdog(s)
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
	if pNeed {
		go h.resolvePreview(s, pKey, pTitle, pArtist)
	}
	h.persist(s)
}

// armTimer schedules (or clears) the round countdown. Caller holds s.mu.
func (h *Hub) armTimer(s *RoomSession) {
	r := s.room
	timed := r.Stage == game.StagePlaying && !r.Paused && r.Current != nil && !r.Current.Deadline.IsZero()
	if !timed {
		if s.timer != nil {
			s.timer.Stop()
			s.timer = nil
		}
		s.timerKey = 0
		s.timerDeadline = time.Time{}
		return
	}
	if s.timer != nil && s.timerKey == r.RoundIndex && s.timerDeadline.Equal(r.Current.Deadline) {
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
	deadline := r.Current.Deadline
	s.timerDeadline = deadline
	s.timer = time.AfterFunc(d, func() { h.fireTimeout(s, key, deadline) })
}

// fireTimeout resolves a timed round when its deadline passes.
func (h *Hub) fireTimeout(s *RoomSession, key int, deadline time.Time) {
	s.mu.Lock()
	if s.room.RoundIndex != key || s.room.Stage != game.StagePlaying || s.room.Paused || s.room.Current == nil || !s.room.Current.Deadline.Equal(deadline) {
		s.mu.Unlock()
		return
	}
	s.timer = nil
	s.timerKey = 0
	s.timerDeadline = time.Time{}
	h.engine.Timeout(s.room)
	h.armTimer(s)
	h.armMediaWatchdog(s)
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
	if err != nil {
		previewURL = ""
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
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if u, err := h.db.SessionUser(ctx, token); err == nil {
		return &u.ID, u.DisplayName
	}
	id, err := auth.Verify(h.secret, token)
	if err != nil {
		return nil, ""
	}
	u, err := h.db.UserByID(ctx, id)
	if err != nil {
		return nil, ""
	}
	return &u.ID, u.DisplayName
}

func (h *Hub) watchRoom(c *Client, payload json.RawMessage) {
	var p struct {
		Protocol int    `json:"protocol"`
		Code     string `json:"code"`
		TVToken  string `json:"tvToken"`
		TV       bool   `json:"tv"`
	}
	if json.Unmarshal(payload, &p) != nil {
		c.enqueue(errorMsg("Перевір код кімнати."))
		return
	}
	s := h.session(strings.ToUpper(strings.TrimSpace(p.Code)))
	if s == nil {
		c.enqueue(errorMsg("Кімнату не знайдено."))
		return
	}
	if c.session != nil {
		h.disconnect(c)
	}
	c.session = s
	c.player = nil
	s.mu.Lock()
	c.protocol = p.Protocol
	if s.room.Config.MelodyMode == "buzzer" && p.Protocol < 3 {
		s.mu.Unlock()
		c.session = nil
		c.enqueue(errorMsg("Для сцени з кнопкою «Знаю пісню» потрібне оновлення застосунку."))
		return
	}
	s.room.EnsureMedia()
	if p.TV || p.TVToken != "" {
		if subtle.ConstantTimeCompare([]byte(p.TVToken), []byte(s.room.TVToken)) != 1 {
			s.mu.Unlock()
			c.session = nil
			c.enqueue(errorMsg("Посилання TV недійсне. Відкрий нове з пульта ведучого."))
			return
		}
		c.partyTV = true
		c.mediaSupported = true
		for old := range s.clients {
			if old.partyTV {
				delete(s.clients, old)
				old.enqueue([]byte(`{"type":"replaced","message":"Звук передано іншому TV-екрану."}`))
				go func(peer *Client) { time.Sleep(100 * time.Millisecond); peer.conn.Close() }(old)
			}
		}
		if s.room.Media.Output == "tv" {
			h.engine.Pause(s.room)
			s.room.Media.Ready = false
			s.room.Media.Enabled = false
		}
	} else {
		c.partyTV = false
	}
	if len(s.clients) >= 64 {
		s.mu.Unlock()
		c.session = nil
		c.enqueue(errorMsg("У кімнаті забагато підключень."))
		return
	}
	s.clients[c] = true
	s.refreshMediaPresence()
	msgs := s.renderAll()
	s.mu.Unlock()
	ack, _ := json.Marshal(map[string]any{"type": "watching", "tv": c.partyTV})
	c.enqueue(ack)
	for _, m := range msgs {
		m.c.enqueue(m.b)
	}
}

func (h *Hub) attach(c *Client, s *RoomSession, p *game.Player) {
	c.session = s
	c.player = p
	s.mu.Lock()
	if p.IsHost {
		for old := range s.clients {
			if old.player == p {
				delete(s.clients, old)
				old.enqueue([]byte(`{"type":"replaced","message":"Пульт ведучого відкрито на іншому пристрої."}`))
				go func(peer *Client) { time.Sleep(100 * time.Millisecond); peer.conn.Close() }(old)
			}
		}
		h.engine.Pause(s.room)
		s.room.Media.Ready = false
		if s.room.Media.Output == "host" {
			s.room.Media.Enabled = false
		}
	}
	s.clients[c] = true
	s.refreshMediaPresence()
	p.Connected = true
	you := youAre(p, s.room.Code, s.room.TVToken)
	msgs := s.renderAll()
	h.armTimer(s)
	pNeed, pKey, pTitle, pArtist := h.previewRequest(s)
	history := make([][]byte, 0, len(s.chatLog))
	for _, m := range s.chatLog {
		if b, err := json.Marshal(m); err == nil {
			history = append(history, b)
		}
	}
	s.mu.Unlock()
	c.enqueue(you)
	for _, b := range history {
		c.enqueue(b)
	}
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
	s.refreshMediaPresence()
	if c.partyTV && s.room.Media.Output == "tv" && s.audioOwner() == nil {
		h.engine.Pause(s.room)
		s.room.Media.Ready = false
		s.room.Media.Notice = "TV від’єднався. Поверни екран або обери звук на телефоні."
		h.armTimer(s)
	}
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
			if c.player.IsHost {
				h.engine.Pause(s.room)
				h.armTimer(s)
			}
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
	h.persist(s)
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

func youAre(p *game.Player, code string, tvTokens ...string) []byte {
	tvToken := ""
	if p.IsHost && len(tvTokens) > 0 {
		tvToken = tvTokens[0]
	}
	b, _ := json.Marshal(youAreMsg{
		TVToken:  tvToken,
		Type:     "you_are",
		PlayerID: p.ID,
		Token:    p.Token,
		Code:     code,
		Host:     p.IsHost,
	})
	return b
}
