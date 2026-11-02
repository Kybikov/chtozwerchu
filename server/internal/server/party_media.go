package server

import (
	"encoding/json"
	"errors"
	"math"
	"time"

	"chtozverchu/internal/game"
)

type mediaStatus struct {
	Enabled  bool    `json:"enabled"`
	Revision uint64  `json:"revision"`
	Round    int     `json:"round"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
	Ready    bool    `json:"ready"`
	Playing  bool    `json:"playing"`
	Failed   bool    `json:"failed"`
}

func (s *RoomSession) audioOwner() *Client {
	for c := range s.clients {
		if s.room.Media.Output == "tv" && c.partyTV {
			return c
		}
		if s.room.Media.Output == "host" && c.mediaSupported && c.player != nil && c.player.IsHost {
			return c
		}
	}
	return nil
}
func (s *RoomSession) refreshMediaPresence() {
	s.room.EnsureMedia()
	s.room.Media.TVConnected = false
	for c := range s.clients {
		if c.partyTV {
			s.room.Media.TVConnected = true
		}
	}
	s.room.Media.Connected = s.audioOwner() != nil
}
func (h *Hub) mediaAction(s *RoomSession, c *Client, p actionPayload) (bool, error) {
	name := p.Name
	r := s.room
	r.EnsureMedia()
	m := r.Media
	explicit := name == "audio_output" || name == "audio_play" || name == "audio_replay" || name == "audio_volume"
	if !explicit && !(name == "resume" && c.mediaSupported && r.Current != nil && r.Current.Type == game.RoundMelody) {
		return false, nil
	}
	if c.player == nil || !c.player.IsHost {
		return true, game.ErrNotHost
	}
	switch name {
	case "audio_output":
		output, _ := p.Payload["output"].(string)
		if output != "host" && output != "tv" {
			return true, errors.New("Обери звук на цьому пристрої або на TV.")
		}
		if m.Output == output {
			return true, nil
		}
		if r.Stage == game.StagePlaying && r.Current != nil && r.Current.Type == game.RoundMelody {
			h.engine.Pause(r)
		}
		r.StopMedia()
		m.Output = output
		m.Ready = false
		m.Enabled = false
		m.Notice = ""
		m.Revision++
		s.mediaLast = time.Time{}
		s.refreshMediaPresence()
		return true, nil
	case "audio_volume":
		volume, ok := p.Payload["volume"].(float64)
		if !ok || math.IsNaN(volume) || math.IsInf(volume, 0) || volume < 0 || volume > 100 {
			return true, errors.New("Гучність має бути від 0 до 100.")
		}
		m.Volume = int(math.Round(volume))
		return true, nil
	}
	if r.Stage != game.StagePlaying || r.Current == nil || r.Current.Type != game.RoundMelody {
		return true, game.ErrBadStage
	}
	round, _ := game.BuildView(r, c.player).Round.(map[string]any)
	if round["previewUrl"] == "" && round["previewStatus"] == "unavailable" {
		return false, nil
	}
	if s.audioOwner() == nil || !m.Ready || time.Since(s.mediaLast) > 4*time.Second {
		return true, errors.New("Спочатку дозволь звук на вибраному пристрої та дочекайся завантаження фрагмента.")
	}
	if m.Playing && m.Wanted && !r.Paused && name != "audio_replay" {
		return true, nil
	}
	h.engine.Pause(r) // Playback acknowledgement starts the deadline, not the click.
	if name == "audio_replay" {
		m.Position = 0
	}
	m.Revision++
	m.Wanted = true
	m.Pending = true
	m.Playing = false
	m.Notice = ""
	s.mediaLast = time.Now()
	s.mediaRequested = s.mediaLast
	s.mediaProgress = s.mediaLast
	h.armMediaWatchdog(s)
	return true, nil
}
func (h *Hub) receiveMedia(c *Client, payload json.RawMessage) {
	s := c.session
	if s == nil {
		return
	}
	var status mediaStatus
	if json.Unmarshal(payload, &status) != nil || math.IsNaN(status.Position) || math.IsInf(status.Position, 0) || math.IsNaN(status.Duration) || math.IsInf(status.Duration, 0) || status.Position < 0 || status.Duration < 0 || status.Duration > 86400 || status.Position > status.Duration+.5 || status.Ready && status.Duration <= 0 {
		return
	}
	s.mu.Lock()
	r := s.room
	r.EnsureMedia()
	m := r.Media
	if !s.clients[c] || s.audioOwner() != c || status.Revision != m.Revision || status.Round != r.RoundIndex {
		s.mu.Unlock()
		return
	}
	beforeReady, beforePlaying, beforePending, beforeWanted, beforeEnabled := m.Ready, m.Playing, m.Pending, m.Wanted, m.Enabled
	m.Enabled = status.Enabled
	m.Ready = status.Enabled && status.Ready
	s.mediaLast = time.Now()
	if math.Abs(m.Position-status.Position) > .015 || (!m.Playing && status.Playing) {
		s.mediaProgress = time.Now()
	}
	m.Position = status.Position
	m.Duration = status.Duration
	if status.Failed || !m.Ready && (m.Wanted || m.Pending) {
		h.engine.Pause(r)
		m.Ready = false
		m.Notice = "Звук зупинився. Дозволь його на екрані та продовжуй із пульта."
	} else if m.Wanted && status.Playing {
		if m.Pending {
			if err := h.engine.Apply(r, game.Action{Name: "resume", IsHost: true}); err != nil {
				r.StopMedia()
			} else {
				m.Pending = false
			}
		}
		m.Playing = m.Wanted
	} else if !status.Playing && !m.Pending {
		m.Playing = false
		if m.Wanted {
			m.Wanted = false
			m.Revision++
		} // Natural end keeps answer time running.
	} else if status.Playing && !m.Wanted {
		r.StopMedia()
		m.Revision++
	}
	changed := beforeReady != m.Ready || beforePlaying != m.Playing || beforePending != m.Pending || beforeWanted != m.Wanted || status.Failed || beforeEnabled != m.Enabled
	h.armTimer(s)
	h.armMediaWatchdog(s)
	if changed {
		for _, msg := range s.renderAll() {
			msg.c.enqueue(msg.b)
		}
		h.savePartyLocked(s)
	} else if time.Since(s.mediaClock) > 500*time.Millisecond {
		s.mediaClock = time.Now()
		b, _ := json.Marshal(map[string]any{"type": "media_clock", "media": m, "serverTime": time.Now().UnixMilli()})
		for peer := range s.clients {
			peer.enqueue(b)
		}
	}
	s.mu.Unlock()
}
func (h *Hub) armMediaWatchdog(s *RoomSession) {
	if s.mediaTimer != nil {
		s.mediaTimer.Stop()
		s.mediaTimer = nil
	}
	if !s.room.Media.Wanted && !s.room.Media.Pending {
		return
	}
	deadline := s.mediaLast.Add(4500 * time.Millisecond)
	if s.room.Media.Playing && s.mediaProgress.Add(4500*time.Millisecond).Before(deadline) {
		deadline = s.mediaProgress.Add(4500 * time.Millisecond)
	}
	if s.room.Media.Pending && s.mediaRequested.Add(4500*time.Millisecond).Before(deadline) {
		deadline = s.mediaRequested.Add(4500 * time.Millisecond)
	}
	s.mediaTimer = time.AfterFunc(max(0, time.Until(deadline)), func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		pendingExpired := s.room.Media.Pending && time.Since(s.mediaRequested) >= 4*time.Second
		stalled := s.room.Media.Playing && time.Since(s.mediaProgress) >= 4*time.Second
		if (!stalled && !pendingExpired && time.Since(s.mediaLast) < 4*time.Second) || (!s.room.Media.Wanted && !s.room.Media.Pending) {
			return
		}
		h.engine.Pause(s.room)
		s.room.Media.Ready = false
		s.room.Media.Notice = "Екран зі звуком не відповідає. Перевір підключення й продовжуй із пульта."
		h.armTimer(s)
		h.savePartyLocked(s)
		for _, m := range s.renderAll() {
			m.c.enqueue(m.b)
		}
	})
}
