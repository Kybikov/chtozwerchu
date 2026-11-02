package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type clusterOutput struct {
	id    string
	data  []byte
	close bool
}
type clusterPeer struct {
	cluster        *roomCluster
	conn           *websocket.Conn
	cookie, kind   string
	mu             sync.Mutex
	id, owner      string
	binding        roomBinding
	sent, received uint64
	queued         int
	out            chan clusterOutput
	done           chan struct{}
	once           sync.Once
}

func (p *clusterPeer) route() roomBinding { p.mu.Lock(); defer p.mu.Unlock(); return p.binding }
func (p *clusterPeer) close() {
	p.once.Do(func() {
		close(p.done)
		p.conn.Close()
		p.mu.Lock()
		id, owner, b := p.id, p.owner, p.binding
		p.mu.Unlock()
		p.cluster.mu.Lock()
		if p.cluster.peers[id] == p {
			delete(p.cluster.peers, id)
		}
		p.cluster.mu.Unlock()
		if owner != "" {
			go func() { _ = p.cluster.publish(owner, relayPacket{Op: "close", ID: id, Binding: b}, false) }()
		}
	})
}
func (p *clusterPeer) output(id string, data []byte, closing bool) {
	select {
	case <-p.done:
		return
	default:
	}
	p.mu.Lock()
	if p.queued+len(data) > 2<<20 {
		p.mu.Unlock()
		p.close()
		return
	}
	p.queued += len(data)
	p.mu.Unlock()
	select {
	case p.out <- clusterOutput{id, data, closing}:
	default:
		p.mu.Lock()
		p.queued -= len(data)
		p.mu.Unlock()
		p.close()
	}
}
func (p *clusterPeer) writer() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	defer p.close()
	for {
		select {
		case <-p.done:
			return
		case msg := <-p.out:
			p.mu.Lock()
			p.queued -= len(msg.data)
			current := p.id
			p.mu.Unlock()
			if current != msg.id {
				continue
			}
			if len(msg.data) > 0 {
				p.conn.SetWriteDeadline(time.Now().Add(writeWait))
				if p.conn.WriteMessage(websocket.TextMessage, msg.data) != nil {
					return
				}
			}
			if msg.close {
				return
			}
		case <-ticker.C:
			p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if p.conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}

func relayIntent(kind string, data []byte) (roomBinding, bool, error) {
	var m struct {
		Type    string `json:"type"`
		Code    string `json:"code"`
		Payload struct {
			Code string `json:"code"`
		} `json:"payload"`
	}
	if json.Unmarshal(data, &m) != nil {
		return roomBinding{}, false, nil
	}
	if kind == "studio" {
		if m.Type != "auth" {
			return roomBinding{}, false, nil
		}
		b := roomBinding{Kind: kind, Code: m.Code}
		if !validRoomBinding(b) {
			return b, true, errRoomMissing
		}
		return b, true, nil
	}
	if m.Type == "create_room" {
		return roomBinding{Kind: kind}, true, nil
	}
	if m.Type == "join" || m.Type == "watch" {
		b := roomBinding{Kind: kind, Code: strings.ToUpper(strings.TrimSpace(m.Payload.Code))}
		if !validRoomBinding(b) {
			return b, true, errRoomMissing
		}
		return b, true, nil
	}
	return roomBinding{}, false, nil
}
func (p *clusterPeer) bind(b roomBinding, data []byte) error {
	c := p.cluster
	if b.Code != "" {
		var err error
		b, err = c.resolve(b.Kind, b.Code)
		if err != nil {
			return err
		}
	}
	owner := c.id
	if b.Epoch != "" {
		owner = ownerNode(b.Epoch)
	}
	p.mu.Lock()
	oldID, oldOwner, oldBinding := p.id, p.owner, p.binding
	p.id = studioSecret()
	p.owner = owner
	p.binding = b
	p.sent = 1
	p.received = 0
	id := p.id
	p.mu.Unlock()
	c.mu.Lock()
	delete(c.peers, oldID)
	c.peers[id] = p
	c.mu.Unlock()
	if oldOwner != "" {
		go func() { _ = c.publish(oldOwner, relayPacket{Op: "close", ID: oldID, Binding: oldBinding}, false) }()
	}
	return c.publish(owner, relayPacket{Op: "open", ID: id, Binding: b, Sequence: 1, Data: data, Cookie: p.cookie}, false)
}
func (p *clusterPeer) reader() {
	defer p.close()
	limit := int64(maxMessage)
	if p.kind == "studio" {
		limit = 512 << 10
	}
	p.conn.SetReadLimit(limit)
	p.conn.SetReadDeadline(time.Now().Add(pongWait))
	p.conn.SetPongHandler(func(string) error { return p.conn.SetReadDeadline(time.Now().Add(pongWait)) })
	window, count := time.Now(), 0
	for {
		_, data, err := p.conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(window) > time.Second {
			window = time.Now()
			count = 0
		}
		count++
		if count > 30 {
			return
		}
		b, intent, err := relayIntent(p.kind, data)
		if intent {
			if err == nil {
				err = p.bind(b, data)
			}
			if err != nil {
				p.mu.Lock()
				id := p.id
				p.mu.Unlock()
				if errors.Is(err, errRoomMissing) {
					kind := "error"
					if p.kind == "studio" {
						kind = "fatal"
					}
					body, _ := json.Marshal(map[string]string{"type": kind, "message": "Кімнату не знайдено або час її дії вийшов."})
					p.output(id, body, p.kind == "studio")
					continue
				}
				return
			}
			continue
		}
		p.mu.Lock()
		id, owner, b := p.id, p.owner, p.binding
		p.sent++
		sequence := p.sent
		p.mu.Unlock()
		if owner == "" {
			var m struct {
				Type string `json:"type"`
			}
			_ = json.Unmarshal(data, &m)
			if m.Type == "ping" {
				p.output(id, []byte(`{"type":"pong"}`), false)
			} else {
				p.output(id, errorMsg("Спочатку створи кімнату або приєднайся за кодом."), false)
			}
			continue
		}
		if p.cluster.publish(owner, relayPacket{Op: "data", ID: id, Binding: b, Sequence: sequence, Data: data}, false) != nil {
			return
		}
	}
}
func (c *roomCluster) serveWS(kind string, w http.ResponseWriter, r *http.Request) {
	if !c.ready.Load() {
		http.Error(w, "З’єднання з грою відновлюється. Спробуй за мить.", 503)
		return
	}
	c.mu.Lock()
	full := len(c.peers) >= 2048
	c.mu.Unlock()
	if full {
		http.Error(w, "Сервер зайнятий", 503)
		return
	}
	up := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: studioOrigin}
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	p := &clusterPeer{cluster: c, conn: conn, kind: kind, id: studioSecret(), out: make(chan clusterOutput, 32), done: make(chan struct{})}
	if cookie, e := r.Cookie(sessionCookie); e == nil && len(cookie.Value) <= 4096 {
		p.cookie = cookie.Value
	}
	c.mu.Lock()
	c.peers[p.id] = p
	c.mu.Unlock()
	go p.writer()
	go p.reader()
}

func (c *roomCluster) receive(p relayPacket) {
	if !c.ready.Load() || len(p.ID) > 80 || len(p.From) > 80 || p.ID == "" || p.From == "" {
		return
	}
	switch p.Op {
	case "open":
		if p.Binding.Kind != "party" && p.Binding.Kind != "studio" || len(p.Cookie) > 4096 || p.Sequence != 1 {
			return
		}
		if p.Binding.Code != "" && !c.owns(p.Binding) {
			return
		}
		if p.Binding.Code == "" && p.Binding.Kind != "party" {
			return
		}
		c.mu.Lock()
		if c.remote[p.ID] != nil || len(c.remote) >= 4096 {
			c.mu.Unlock()
			return
		}
		c.mu.Unlock()
		var socket *clusterSocket
		var sequence uint64
		socket = newClusterSocket(p.Binding, func(b roomBinding, data []byte, closing bool, deadline time.Time) error {
			sequence++
			op := "reply"
			if closing {
				op = "bye"
				c.mu.Lock()
				if entry := c.remote[p.ID]; entry != nil && entry.socket == socket {
					delete(c.remote, p.ID)
				}
				c.mu.Unlock()
			}
			if b.Code != "" && !c.owns(b) {
				return errRoomOwner
			}
			return c.publish(p.From, relayPacket{Op: op, ID: p.ID, Binding: b, Sequence: sequence, Data: data}, b.Code != "")
		})
		c.mu.Lock()
		c.remote[p.ID] = &clusterRemote{socket: socket, from: p.From}
		c.mu.Unlock()
		if !socket.deliver(p.Sequence, p.Data) {
			socket.Close()
			return
		}
		go c.hooks.accept(p.Binding.Kind, socket, p.Cookie)
	case "data", "close":
		c.mu.Lock()
		remote := c.remote[p.ID]
		c.mu.Unlock()
		if remote == nil || remote.from != p.From {
			return
		}
		if p.Op == "close" || !remote.socket.deliver(p.Sequence, p.Data) {
			remote.socket.Close()
		}
	case "reply", "bye":
		c.mu.Lock()
		peer := c.peers[p.ID]
		c.mu.Unlock()
		if peer == nil {
			return
		}
		peer.mu.Lock()
		if peer.id != p.ID || peer.owner != p.From || p.Sequence <= peer.received {
			peer.mu.Unlock()
			return
		}
		if p.Sequence != peer.received+1 {
			peer.mu.Unlock()
			peer.close()
			return
		}
		if peer.binding.Code == "" && p.Binding.Code != "" {
			peer.binding = p.Binding
		}
		if peer.binding != p.Binding {
			peer.mu.Unlock()
			peer.close()
			return
		}
		peer.received = p.Sequence
		peer.mu.Unlock()
		peer.output(p.ID, p.Data, p.Op == "bye")
	case "end":
		if !c.owns(p.Binding) || p.Binding.Kind != "studio" || len(p.Authorization) > 512 {
			return
		}
		go func() {
			status, body := c.hooks.end(c.ctx, p.Binding, p.Authorization)
			_ = c.publish(p.From, relayPacket{Op: "http_reply", ID: p.ID, Status: status, Data: body}, false)
		}()
	case "http_reply":
		c.mu.Lock()
		waiter, ok := c.waiters[p.ID]
		c.mu.Unlock()
		if ok && waiter.owner == p.From && p.Status >= 100 && p.Status <= 599 {
			select {
			case waiter.reply <- clusterHTTPReply{p.Status, p.Data}:
			default:
			}
		}
	}
}

func (c *roomCluster) endHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !studioOrigin(r) {
		writeJSON(w, 403, map[string]string{"error": "Недозволене джерело запиту."})
		return
	}
	b, err := c.resolve("studio", r.PathValue("code"))
	if err != nil {
		status := 503
		if errors.Is(err, errRoomMissing) {
			status = 404
		}
		writeJSON(w, status, map[string]string{"error": "Кімнату не знайдено або сервер відновлює зв’язок."})
		return
	}
	id := studioSecret()
	waiter := make(chan clusterHTTPReply, 1)
	c.mu.Lock()
	c.waiters[id] = clusterHTTPWaiter{owner: ownerNode(b.Epoch), reply: waiter}
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.waiters, id); c.mu.Unlock() }()
	if c.publish(ownerNode(b.Epoch), relayPacket{Op: "end", ID: id, Binding: b, Authorization: r.Header.Get("Authorization")}, false) != nil {
		writeJSON(w, 503, map[string]string{"error": "Зв’язок із кімнатою відновлюється."})
		return
	}
	select {
	case reply := <-waiter:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(reply.status)
		_, _ = w.Write(reply.body)
	case <-r.Context().Done():
		return
	case <-time.After(5 * time.Second):
		writeJSON(w, 503, map[string]string{"error": "Не вдалося завершити кімнату. Повтори спробу."})
	}
}
