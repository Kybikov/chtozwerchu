package server

import (
	"time"

	"github.com/gorilla/websocket"

	"chtozverchu/internal/game"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 15 * time.Second
	pingPeriod = 5 * time.Second
	maxMessage = 16 * 1024
	sendBuffer = 32
)

// Client is a single WebSocket connection.
type Client struct {
	protocol       int
	mediaSupported bool
	partyTV        bool
	hub            *Hub
	conn           roomConnection
	send           chan []byte
	session        *RoomSession
	player         *game.Player
	userID         *string
	displayName    string
}

func (c *Client) readPump() {
	defer func() {
		c.hub.disconnect(c)
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessage)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	window := time.Now()
	count := 0
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(window) > time.Second {
			window = time.Now()
			count = 0
		}
		count++
		if count > 30 {
			c.enqueue(errorMsg("Забагато дій. Спробуй за мить."))
			continue
		}
		c.hub.handleMessage(c, data)
	}
}

func (c *Client) writePump() {
	var lastRevision uint64
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if ok && !freshPartyMessage(msg, &lastRevision) {
				continue
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// enqueue sends a message to the client, dropping it if the buffer is full
// (a slow/dead client must not block the room).
func (c *Client) enqueue(msg []byte) {
	select {
	case c.send <- msg:
	default:
	}
}
