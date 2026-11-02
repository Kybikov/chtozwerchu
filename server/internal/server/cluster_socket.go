package server

import (
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// roomConnection lets the unchanged game protocols run over a local WebSocket
// or a bounded Redis relay. Authentication and per-viewer redaction stay in the
// game hubs, rather than being reimplemented in the transport.
type roomConnection interface {
	ReadMessage() (int, []byte, error)
	ReadJSON(any) error
	WriteMessage(int, []byte) error
	WriteJSON(any) error
	SetReadDeadline(time.Time) error
	SetWriteDeadline(time.Time) error
	SetReadLimit(int64)
	SetPongHandler(func(string) error)
	Close() error
}

type roomBinding struct {
	Kind  string `json:"kind"`
	Code  string `json:"code"`
	Epoch string `json:"epoch"`
}

func bindRoomConnection(conn roomConnection, binding roomBinding) bool {
	if relay, ok := conn.(*clusterSocket); ok {
		return relay.bind(binding)
	}
	return true
}

var errRelayClosed = errors.New("room relay closed")

type clusterSocket struct {
	mu                    sync.Mutex
	writeMu               sync.Mutex
	readUntil, writeUntil time.Time
	limit                 int64
	queued                int
	sequence              uint64
	pong                  func(string) error
	binding               roomBinding
	in                    chan []byte
	wake                  chan struct{}
	done                  chan struct{}
	once                  sync.Once
	emit                  func(roomBinding, []byte, bool, time.Time) error
}

func newClusterSocket(binding roomBinding, emit func(roomBinding, []byte, bool, time.Time) error) *clusterSocket {
	return &clusterSocket{binding: binding, limit: 512 << 10, in: make(chan []byte, 64), wake: make(chan struct{}, 1), done: make(chan struct{}), emit: emit}
}

func (c *clusterSocket) bind(b roomBinding) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.binding.Code != "" && c.binding != b {
		return false
	}
	c.binding = b
	return true
}

func (c *clusterSocket) deliver(sequence uint64, data []byte) bool {
	c.mu.Lock()
	if sequence <= c.sequence {
		c.mu.Unlock()
		return true
	}
	if sequence != c.sequence+1 || len(data) > 512<<10 || c.queued+len(data) > 2<<20 {
		c.mu.Unlock()
		return false
	}
	select {
	case <-c.done:
		c.mu.Unlock()
		return false
	default:
	}
	select {
	case c.in <- data:
		c.sequence = sequence
		c.queued += len(data)
		c.mu.Unlock()
		return true
	default:
		c.mu.Unlock()
		return false
	}
}

func (c *clusterSocket) ReadMessage() (int, []byte, error) {
	for {
		select {
		case <-c.done:
			return 0, nil, errRelayClosed
		default:
		}
		c.mu.Lock()
		deadline := c.readUntil
		c.mu.Unlock()
		var alarm <-chan time.Time
		var timer *time.Timer
		if !deadline.IsZero() {
			timer = time.NewTimer(max(0, time.Until(deadline)))
			alarm = timer.C
		}
		select {
		case data := <-c.in:
			if timer != nil {
				timer.Stop()
			}
			c.mu.Lock()
			c.queued -= len(data)
			limit := c.limit
			c.mu.Unlock()
			select {
			case <-c.done:
				return 0, nil, errRelayClosed
			default:
			}
			if int64(len(data)) > limit {
				return 0, nil, io.ErrShortBuffer
			}
			return websocket.TextMessage, data, nil
		case <-c.done:
			if timer != nil {
				timer.Stop()
			}
			return 0, nil, errRelayClosed
		case <-c.wake:
			if timer != nil {
				timer.Stop()
			}
		case <-alarm:
			return 0, nil, errors.New("room relay read timeout")
		}
	}
}
func (c *clusterSocket) ReadJSON(v any) error {
	_, b, err := c.ReadMessage()
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}
func (c *clusterSocket) WriteJSON(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.WriteMessage(websocket.TextMessage, b)
}
func (c *clusterSocket) WriteMessage(kind int, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.done:
		return errRelayClosed
	default:
	}
	c.mu.Lock()
	binding, deadline, pong := c.binding, c.writeUntil, c.pong
	c.mu.Unlock()
	if kind == websocket.PingMessage {
		if pong != nil {
			return pong("")
		}
		return nil
	}
	if kind == websocket.CloseMessage {
		return c.Close()
	}
	if kind != websocket.TextMessage {
		return errors.New("unsupported relay frame")
	}
	return c.emit(binding, data, false, deadline)
}
func (c *clusterSocket) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	c.readUntil = t
	c.mu.Unlock()
	select {
	case c.wake <- struct{}{}:
	default:
	}
	return nil
}
func (c *clusterSocket) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	c.writeUntil = t
	c.mu.Unlock()
	return nil
}
func (c *clusterSocket) SetReadLimit(n int64)                { c.mu.Lock(); c.limit = n; c.mu.Unlock() }
func (c *clusterSocket) SetPongHandler(f func(string) error) { c.mu.Lock(); c.pong = f; c.mu.Unlock() }
func (c *clusterSocket) Close() error {
	c.once.Do(func() {
		close(c.done)
		go func() {
			c.writeMu.Lock()
			defer c.writeMu.Unlock()
			c.mu.Lock()
			b := c.binding
			c.mu.Unlock()
			_ = c.emit(b, nil, true, time.Now().Add(time.Second))
		}()
	})
	return nil
}
