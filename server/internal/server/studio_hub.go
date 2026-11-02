package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"chtozverchu/internal/store"
	"github.com/gorilla/websocket"
)

type studioRoom struct {
	binding        roomBinding
	lost           bool
	OwnerID        string `json:"ownerId,omitempty"`
	ArchivedKey    string `json:"archivedKey,omitempty"`
	historySaving  bool
	historyAttempt time.Time
	mu             sync.Mutex
	Code           string      `json:"code"`
	StationHash    [32]byte    `json:"stationHash"`
	HostHash       [32]byte    `json:"hostHash"`
	Expires        int64       `json:"expires"`
	State          studioState `json:"state"`
	clients        map[*studioPeer]bool
	seen           map[string]bool
	seenOrder      []string
	lastAudio      time.Time
	lastSaved      time.Time
	lastBeat       time.Time
	dirty          bool
}
type studioHub struct {
	cluster *roomCluster
	db      *store.DB
	owner   func(*http.Request) *store.User
	mu      sync.Mutex
	rooms   map[string]*studioRoom
	dir     string
	stop    chan struct{}
}
type studioPeer struct {
	hub  *studioHub
	room *studioRoom
	role string
	conn roomConnection
	send chan []byte
	done chan struct{}
	once sync.Once
}
type studioEnvelope struct {
	Type    string       `json:"type"`
	Token   string       `json:"token"`
	Role    string       `json:"role"`
	Code    string       `json:"code"`
	Action  studioAction `json:"action"`
	Audio   studioAudio  `json:"audio"`
	Track   musicTrack   `json:"track"`
	Offset  int64        `json:"offset"`
	Aligned bool         `json:"aligned"`
	Target  int          `json:"target"`
}

func newStudioHub(dir string, databases ...*store.DB) *studioHub {
	h := loadStudioHub(dir, databases...)
	go h.tick()
	return h
}

// The server starts ticking only after migration and transport wiring finish.
func loadStudioHub(dir string, databases ...*store.DB) *studioHub {
	h := &studioHub{rooms: map[string]*studioRoom{}, dir: dir, stop: make(chan struct{})}
	if len(databases) > 0 {
		h.db = databases[0]
	}
	if dir != "" {
		if err := os.MkdirAll(dir, 0700); err == nil {
			entries, _ := os.ReadDir(dir)
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") || len(h.rooms) >= 200 {
					continue
				}
				path := filepath.Join(dir, e.Name())
				f, err := os.Open(path)
				if err != nil {
					continue
				}
				var room studioRoom
				err = json.NewDecoder(io.LimitReader(f, 2<<20)).Decode(&room)
				f.Close()
				if err != nil || !validStudioCode(room.Code) || e.Name() != room.Code+".json" || room.Expires <= time.Now().UnixMilli() || validateStudio(room.State.Session, room.State.Track, room.State.Audio) != nil {
					continue
				}
				resetRestoredStudio(&room)
				h.rooms[room.Code] = &room
			}
		}
	}
	return h
}
func (h *studioHub) close() {
	close(h.stop)
	h.mu.Lock()
	rooms := make([]*studioRoom, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	for _, r := range rooms {
		r.mu.Lock()
		for p := range r.clients {
			p.close()
		}
		r.mu.Unlock()
	}
}
func studioSecret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("secure randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

const studioAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newStudioCode() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic("secure randomness unavailable")
	}
	for i := range b {
		b[i] = studioAlphabet[int(b[i])%len(studioAlphabet)]
	}
	return string(b)
}
func validStudioCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, c := range code {
		if !strings.ContainsRune(studioAlphabet, c) {
			return false
		}
	}
	return true
}
func studioOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && strings.EqualFold(u.Host, r.Host)
}
func (s *Server) registerStudioRoutes(mux *http.ServeMux) {
	h := s.studio
	if h == nil {
		h = newStudioHub(os.Getenv("STUDIO_STATE_DIR"), s.db)
		h.owner = s.userFromRequest
		s.studio = h
	}
	if s.cluster != nil {
		mux.HandleFunc("POST /api/studio/rooms", func(w http.ResponseWriter, r *http.Request) {
			if !s.cluster.ready.Load() {
				http.Error(w, "Зв’язок із грою відновлюється", 503)
				return
			}
			h.create(w, r)
		})
		mux.HandleFunc("DELETE /api/studio/rooms/{code}", s.cluster.endHTTP)
		mux.HandleFunc("GET /api/studio/ws", func(w http.ResponseWriter, r *http.Request) { s.cluster.serveWS("studio", w, r) })
	} else if s.cfg.RedisURL != "" {
		offline := func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Зв’язок із грою відновлюється", 503)
		}
		mux.HandleFunc("POST /api/studio/rooms", offline)
		mux.HandleFunc("DELETE /api/studio/rooms/{code}", offline)
		mux.HandleFunc("GET /api/studio/ws", offline)
	} else {
		mux.HandleFunc("POST /api/studio/rooms", h.create)
		mux.HandleFunc("DELETE /api/studio/rooms/{code}", h.end)
		mux.HandleFunc("GET /api/studio/ws", h.connect)
	}
}
func (h *studioHub) create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !studioOrigin(r) {
		writeJSON(w, 403, map[string]string{"error": "Недозволене джерело запиту."})
		return
	}
	var input struct {
		Session studioSession `json:"session"`
		Track   musicTrack    `json:"track"`
		Audio   studioAudio   `json:"audio"`
		Effects bool          `json:"effects"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input) != nil {
		writeJSON(w, 400, map[string]string{"error": "Некоректна підготовка кімнати."})
		return
	}
	if err := validateStudio(input.Session, input.Track, input.Audio); err != nil {
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}
	if len(input.Track.Cues) == 0 {
		writeJSON(w, 400, map[string]string{"error": "Перед підключенням телефону додай текст із часовими мітками."})
		return
	}
	station, host := studioSecret(), studioSecret()
	room := &studioRoom{StationHash: sha256.Sum256([]byte(station)), HostHash: sha256.Sum256([]byte(host)), Expires: time.Now().Add(12 * time.Hour).UnixMilli(), clients: map[*studioPeer]bool{}, seen: map[string]bool{}}
	room.State = studioState{Session: input.Session, Track: input.Track, Audio: input.Audio, Phase: "ready", Version: 1, Effects: input.Effects, Timer: studioTimer{LeftMS: int64(input.Session.AnswerSeconds) * 1000, Paused: true}}
	if room.State.Session.MatchID == "" {
		room.State.Session.MatchID = studioSecret()
	}
	if h.owner != nil {
		if u := h.owner(r); u != nil {
			room.OwnerID = u.ID
		}
	}
	if room.State.Session.History == nil {
		room.State.Session.History = []studioHistory{}
	}
	if room.State.completed() {
		room.State.Phase = "result"
		room.State.Awarded = room.State.Session.History[len(room.State.Session.History)-1].Awarded
	}
	if room.State.Session.Finished {
		room.State.Phase = "final"
	}
	room.State.Audio.Playing = false
	room.State.Audio.Ready = false
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= 200 {
		writeJSON(w, 503, map[string]string{"error": "На сервері забагато активних ігор. Спробуй пізніше."})
		return
	}
	for attempt := 0; attempt < 8; attempt++ {
		room.Code = newStudioCode()
		if h.rooms[room.Code] != nil {
			continue
		}
		if h.cluster == nil {
			break
		}
		b, err := h.cluster.reserve("studio", room.Code)
		if err == nil {
			room.binding = b
			break
		}
		if !errors.Is(err, errRoomOwner) || attempt == 7 {
			writeJSON(w, 503, map[string]string{"error": "Не вдалося підключити кімнату. Спробуй за мить."})
			return
		}
	}
	if err := h.save(room); err != nil {
		if h.cluster != nil {
			h.cluster.discardNew(room.binding)
		}
		writeJSON(w, 503, map[string]string{"error": "Не вдалося зберегти кімнату. Локальна гра залишається доступною."})
		return
	}
	h.rooms[room.Code] = room
	h.archive(room)
	writeJSON(w, 201, map[string]any{"code": room.Code, "stationToken": station, "hostToken": host, "expiresAt": room.Expires})
}
func (h *studioHub) get(code string) *studioRoom {
	h.mu.Lock()
	r := h.rooms[code]
	h.mu.Unlock()
	if r == nil {
		return nil
	}
	r.mu.Lock()
	expired := r.Expires <= time.Now().UnixMilli() || r.lost
	r.mu.Unlock()
	if expired {
		return nil
	}
	return r
}
func (h *studioHub) save(room *studioRoom) error {
	if room.lost {
		return errRoomOwner
	}
	room.State.Timer.LeftMS = room.State.left(time.Now())
	if h.dir == "" && h.cluster == nil {
		room.lastSaved = time.Now()
		room.dirty = false
		return nil
	}
	b, err := json.Marshal(room)
	if err != nil {
		return err
	}
	if h.cluster != nil {
		if err = h.cluster.commit(room.binding, b, time.Until(time.UnixMilli(room.Expires))); err != nil {
			room.lost = true
			go h.cluster.lose(room.binding)
			return err
		}
	}
	if h.dir == "" {
		room.lastSaved = time.Now()
		room.dirty = false
		return nil
	}
	name := filepath.Join(h.dir, room.Code+".json")
	tmp := name + ".tmp"
	if err = os.WriteFile(tmp, b, 0600); err != nil {
		if h.cluster != nil {
			log.Printf("studio private backup write failed")
			room.lastSaved = time.Now()
			room.dirty = false
			return nil
		}
		return err
	}
	if err = os.Rename(tmp, name); err != nil {
		if h.cluster != nil {
			log.Printf("studio private backup rename failed")
			room.lastSaved = time.Now()
			room.dirty = false
			return nil
		}
		return err
	}
	room.lastSaved = time.Now()
	room.dirty = false
	return nil
}
func (h *studioHub) end(w http.ResponseWriter, r *http.Request) {
	h.endBound(w, r, nil)
}
func (h *studioHub) endBound(w http.ResponseWriter, r *http.Request, expected *roomBinding) {
	if !studioOrigin(r) {
		writeJSON(w, 403, map[string]string{"error": "Недозволене джерело запиту."})
		return
	}
	room := h.get(r.PathValue("code"))
	if room == nil {
		writeJSON(w, 404, map[string]string{"error": "Кімнату не знайдено."})
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	digest := sha256.Sum256([]byte(token))
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.lost || expected != nil && (room.binding != *expected || !h.cluster.owns(*expected)) {
		writeJSON(w, 503, map[string]string{"error": "Кімната відновлює зв’язок."})
		return
	}
	if subtle.ConstantTimeCompare(digest[:], room.StationHash[:]) != 1 {
		writeJSON(w, 403, map[string]string{"error": "Завершити підключення можна на екрані гри."})
		return
	}
	room.Expires = 0
	if err := h.save(room); err != nil {
		writeJSON(w, 503, map[string]string{"error": "Не вдалося завершити кімнату. Повтори спробу."})
		return
	}
	for p := range room.clients {
		p.queue(map[string]any{"type": "closed", "message": "Мережевий режим завершено на екрані гри."})
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (h *studioHub) connect(w http.ResponseWriter, r *http.Request) {
	up := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: studioOrigin}
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.acceptConnection(conn)
}
func (h *studioHub) acceptConnection(conn roomConnection) {
	_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
	conn.SetReadLimit(512 << 10)
	var hello studioEnvelope
	if conn.ReadJSON(&hello) != nil || hello.Type != "auth" {
		conn.Close()
		return
	}
	room := h.get(hello.Code)
	if room == nil {
		_ = conn.WriteJSON(map[string]string{"type": "fatal", "message": "Кімнату не знайдено або час її дії вийшов."})
		conn.Close()
		return
	}
	role := hello.Role
	hash := sha256.Sum256([]byte(hello.Token))
	room.mu.Lock()
	if room.lost || h.cluster != nil && (!h.cluster.owns(room.binding) || !bindRoomConnection(conn, room.binding)) {
		room.mu.Unlock()
		conn.Close()
		return
	}
	allowed := role == "audience" || role == "station" && subtle.ConstantTimeCompare(hash[:], room.StationHash[:]) == 1 || role == "host" && subtle.ConstantTimeCompare(hash[:], room.HostHash[:]) == 1
	if !allowed || len(room.clients) >= 64 {
		room.mu.Unlock()
		_ = conn.WriteJSON(map[string]string{"type": "fatal", "message": "Немає доступу до цього пульта."})
		conn.Close()
		return
	}
	p := &studioPeer{hub: h, room: room, role: role, conn: conn, send: make(chan []byte, 32), done: make(chan struct{})}
	for old := range room.clients {
		if role != "audience" && old.role == role {
			old.queue(map[string]string{"type": "replaced", "message": "Цей пульт або екран уже відкрито в іншому вікні."})
			delete(room.clients, old)
			go func(old *studioPeer) { time.Sleep(200 * time.Millisecond); old.close() }(old)
		}
	}
	room.clients[p] = true
	if role == "station" {
		room.State.Audio.Ready = false
		room.State.Audio.Playing = false
		room.lastAudio = time.Now()
	}
	h.broadcast(room, true)
	room.mu.Unlock()
	go p.writer()
	go p.reader()
}
func (p *studioPeer) queue(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case p.send <- b:
	default:
		p.close()
	}
}
func (p *studioPeer) close() { p.once.Do(func() { close(p.done); _ = p.conn.Close() }) }
func (p *studioPeer) writer() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	defer p.close()
	for {
		select {
		case <-p.done:
			return
		case b := <-p.send:
			_ = p.conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
			if p.conn.WriteMessage(websocket.TextMessage, b) != nil {
				return
			}
		case <-ticker.C:
			_ = p.conn.SetWriteDeadline(time.Now().Add(8 * time.Second))
			if p.conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}
func (p *studioPeer) reader() {
	defer func() {
		p.close()
		room := p.room
		room.mu.Lock()
		defer room.mu.Unlock()
		if !room.clients[p] {
			return
		}
		delete(room.clients, p)
		if p.role != "audience" {
			room.State.pause(time.Now())
			if p.role == "station" {
				room.State.Audio.Ready = false
			}
			room.State.Notice = "Зв’язок із пультом або екраном втрачено. Гру призупинено."
			room.State.Version++
			p.hub.instruct(room, &studioInstruction{Type: "pause", ID: studioSecret()})
			_ = p.hub.save(room)
		}
		p.hub.broadcast(room, true)
	}()
	_ = p.conn.SetReadDeadline(time.Now().Add(50 * time.Second))
	p.conn.SetPongHandler(func(string) error { return p.conn.SetReadDeadline(time.Now().Add(50 * time.Second)) })
	window := time.Now()
	count := 0
	for {
		var e studioEnvelope
		if p.conn.ReadJSON(&e) != nil {
			return
		}
		if time.Since(window) > time.Second {
			window = time.Now()
			count = 0
		}
		count++
		if count > 30 {
			p.queue(map[string]string{"type": "error", "message": "Забагато дій. Спробуй за мить."})
			continue
		}
		p.hub.receive(p, e)
	}
}
func (h *studioHub) presence(room *studioRoom) map[string]any {
	host, station, audience := false, false, 0
	for p := range room.clients {
		switch p.role {
		case "station":
			station = true
		case "host":
			host = true
		case "audience":
			audience++
		}
	}
	return map[string]any{"host": host, "station": station, "audience": audience}
}
func (h *studioHub) stationReady(room *studioRoom) bool {
	for p := range room.clients {
		if p.role == "station" && time.Since(room.lastAudio) < 3*time.Second {
			return room.State.Audio.Ready
		}
	}
	return false
}
func (h *studioHub) instruct(room *studioRoom, i *studioInstruction) {
	if i == nil {
		return
	}
	for p := range room.clients {
		if p.role == "station" {
			p.queue(map[string]any{"type": "instruction", "instruction": i})
		}
	}
}
func (h *studioHub) receive(p *studioPeer, e studioEnvelope) {
	room := p.room
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.lost || h.cluster != nil && !h.cluster.owns(room.binding) {
		p.close()
		return
	}
	if !room.clients[p] || room.Expires <= time.Now().UnixMilli() {
		p.queue(map[string]string{"type": "closed", "message": "Мережеву гру завершено."})
		return
	}
	fail := func(err error) {
		p.queue(map[string]any{"type": "error", "message": err.Error(), "id": e.Action.ID})
		h.sendState(room, p, true)
	}
	now := time.Now()
	switch e.Type {
	case "prepare_error":
		if p.role != "station" {
			fail(errors.New("Цю дію виконує екран гри."))
			return
		}
		room.State.pause(now)
		room.State.Audio.Ready = false
		room.State.NeedsTrack = true
		room.State.Notice = "Не вдалося завантажити пісню. Обери інший трек."
		room.State.Version++
		_ = h.save(room)
		h.broadcast(room, true)
	case "media_error":
		if p.role != "station" {
			fail(errors.New("Цю дію виконує екран гри."))
			return
		}
		room.State.pause(now)
		room.State.Audio.Ready = false
		room.State.Notice = "Браузер не відтворив музику. Дозволь звук на екрані гри."
		room.State.Version++
		_ = h.save(room)
		h.broadcast(room, true)
	case "telemetry":
		if p.role != "station" {
			fail(errors.New("Цю дію виконує екран гри."))
			return
		}
		if !validStudioAudio(e.Audio) {
			return
		}
		e.Audio.Local = room.State.Audio.Local
		room.State.Audio = e.Audio
		room.dirty = true
		room.lastAudio = now
		cleared := e.Audio.Ready && (strings.HasPrefix(room.State.Notice, "Зв’язок із пультом") || strings.HasPrefix(room.State.Notice, "Екран не відповідає") || strings.HasPrefix(room.State.Notice, "Сервер відновив") || strings.HasPrefix(room.State.Notice, "Браузер не відтворив"))
		if cleared {
			room.State.Notice = ""
			room.State.Version++
		}
		if room.State.Phase == "playing" && e.Audio.Position >= room.State.stopAt() {
			room.State.answer(now)
			room.State.Version++
			h.instruct(room, &studioInstruction{Type: "pause", ID: studioSecret()})
			_ = h.save(room)
			h.broadcast(room, true)
		} else {
			h.broadcast(room, cleared)
		}
	case "prepare":
		if p.role != "station" || room.State.Phase != "ready" {
			fail(errors.New("Підготовка доступна на екрані перед грою."))
			return
		}
		if err := validateStudioTrack(e.Track); err != nil {
			fail(err)
			return
		}
		if !validStudioAudio(e.Audio) || e.Target < 0 || len(e.Track.Cues) > 0 && e.Target >= len(e.Track.Cues) || (e.Offset < -24*3600000 || e.Offset > 24*3600000) {
			fail(errors.New("Некоректна підготовка аудіо."))
			return
		}
		backup := room.State
		room.State.Track = e.Track
		room.State.Session.TrackID = e.Track.ID
		room.State.Session.Offset = e.Offset
		room.State.Session.Target = e.Target
		room.State.Session.Aligned = e.Aligned
		room.State.Audio = e.Audio
		room.State.NeedsTrack = false
		room.State.Notice = ""
		room.State.Version++
		room.lastAudio = now
		if err := h.save(room); err != nil {
			room.State = backup
			room.State.pause(now)
			fail(errors.New("Не вдалося зберегти підготовку. Спробуй ще раз."))
			return
		}
		h.broadcast(room, true)
	case "action":
		if p.role != "host" && p.role != "station" {
			fail(errors.New("Глядач не може керувати грою."))
			return
		}
		a := e.Action
		if len(a.ID) < 8 || len(a.ID) > 80 {
			fail(errors.New("Некоректний ідентифікатор дії."))
			return
		}
		if room.seen[a.ID] {
			h.sendState(room, p, true)
			return
		}
		if a.Version != room.State.Version {
			fail(errors.New("Стан гри оновився. Повтори дію."))
			return
		}
		backupBytes, _ := json.Marshal(room.State)
		var backup studioState
		_ = json.Unmarshal(backupBytes, &backup)
		ins, err := room.State.apply(a, now, h.stationReady(room))
		if err != nil {
			fail(err)
			return
		}
		if err = h.save(room); err != nil {
			room.State = backup
			room.State.pause(now)
			room.State.Notice = "Не вдалося зберегти гру. Перевір сервер перед продовженням."
			room.State.Version++
			h.instruct(room, &studioInstruction{Type: "pause", ID: studioSecret()})
			h.broadcast(room, true)
			fail(errors.New(room.State.Notice))
			return
		}
		room.seen[a.ID] = true
		room.seenOrder = append(room.seenOrder, a.ID)
		if len(room.seenOrder) > 256 {
			delete(room.seen, room.seenOrder[0])
			room.seenOrder = room.seenOrder[1:]
		}
		h.instruct(room, ins)
		h.archive(room)
		h.broadcast(room, true)
	default:
		fail(errors.New("Невідоме повідомлення."))
	}
}
func (h *studioHub) sendState(room *studioRoom, p *studioPeer, full bool) {
	now := time.Now()
	presence := h.presence(room)
	if p.role == "audience" {
		p.queue(map[string]any{"type": "scene", "state": room.public(now), "presence": presence, "serverTime": now.UnixMilli()})
		return
	}
	if full {
		p.queue(map[string]any{"type": "state", "state": room.State, "presence": presence, "serverTime": now.UnixMilli()})
	} else {
		p.queue(map[string]any{"type": "clock", "audio": room.State.Audio, "timer": room.State.Timer, "phase": room.State.Phase, "version": room.State.Version, "presence": presence, "serverTime": now.UnixMilli()})
	}
}
func (h *studioHub) broadcast(room *studioRoom, full bool) {
	if h.cluster != nil && (full || time.Since(room.lastSaved) > 500*time.Millisecond) {
		if room.lost || h.save(room) != nil {
			for p := range room.clients {
				p.close()
			}
			return
		}
	}
	for p := range room.clients {
		h.sendState(room, p, full)
	}
}
func (h *studioHub) tick() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-h.stop:
			return
		case now := <-ticker.C:
			h.mu.Lock()
			rooms := make([]*studioRoom, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.Unlock()
			for _, r := range rooms {
				r.mu.Lock()
				if r.lost || h.cluster != nil && !h.cluster.owns(r.binding) {
					r.mu.Unlock()
					continue
				}
				if now.Sub(r.lastBeat) > time.Second {
					for p := range r.clients {
						p.queue(map[string]any{"type": "heartbeat", "serverTime": now.UnixMilli()})
					}
					r.lastBeat = now
				}
				expired := r.Expires <= now.UnixMilli()
				if expired {
					for p := range r.clients {
						p.queue(map[string]string{"type": "closed", "message": "Час кімнати вийшов."})
						p.close()
					}
					r.mu.Unlock()
					h.mu.Lock()
					if h.rooms[r.Code] == r {
						delete(h.rooms, r.Code)
					}
					h.mu.Unlock()
					if h.cluster != nil {
						h.cluster.release(r.binding)
					}
					if h.dir != "" {
						_ = os.Remove(filepath.Join(h.dir, r.Code+".json"))
					}
					continue
				}
				if r.State.Audio.Playing && now.Sub(r.lastAudio) > 3*time.Second {
					r.State.pause(now)
					r.State.Audio.Ready = false
					r.State.Notice = "Екран не відповідає. Музику призупинено."
					r.State.Version++
					r.dirty = true
					h.instruct(r, &studioInstruction{Type: "pause", ID: studioSecret()})
					h.broadcast(r, true)
				}
				if r.State.Phase == "answer" && !r.State.Timer.Paused && r.State.left(now) == 0 {
					r.State.Timer.LeftMS = 0
					r.State.Timer.Deadline = 0
					r.State.Timer.Paused = true
					r.State.Version++
					r.dirty = true
					h.broadcast(r, true)
				} else if r.State.Phase == "answer" {
					h.broadcast(r, false)
				}
				if r.dirty && now.Sub(r.lastSaved) > 2*time.Second {
					_ = h.save(r)
				}
				h.archive(r)
				r.mu.Unlock()
			}
		}
	}
}

// Construct the audience projection on the server, never by sending private
// track/cue data and relying on CSS to conceal it.
func (r *studioRoom) public(now time.Time) map[string]any {
	s := &r.State
	session := s.Session
	clock := s.Audio.Position*1000 + float64(session.Offset)
	view := map[string]any{"scores": session.Scores, "names": session.Names, "team": session.Team, "round": session.Round, "rounds": session.Rounds, "phase": s.Phase, "playing": s.Audio.Playing, "nowMS": clock, "lyric": "", "awarded": s.Awarded, "remaining": int64(mathCeilStudio(s.left(now), 1000)), "timerPaused": s.Timer.Paused, "effects": s.Effects}
	if s.Phase == "playing" && session.Aligned {
		for i, c := range s.Track.Cues {
			if i < session.Target && clock >= float64(c.StartMS) && clock < float64(c.EndMS) {
				view["lyric"] = c.Text
				if len(c.Words) > 0 {
					view["words"] = c.Words
				}
				break
			}
		}
	}
	if s.Phase == "result" || s.Phase == "final" {
		for _, record := range session.History {
			if record.Round == session.Round {
				view["answer"] = record.Line
				view["track"] = record.Track
				break
			}
		}
	}
	return view
}
func mathCeilStudio(n, divisor int64) int64 { return (n + divisor - 1) / divisor }
