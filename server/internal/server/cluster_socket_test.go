package server

import (
	"bytes"
	"testing"
	"time"
)

func TestClusterSocketSequenceBoundsAndClosure(t *testing.T) {
	s := newClusterSocket(roomBinding{}, func(roomBinding, []byte, bool, time.Time) error { return nil })
	defer s.Close()
	if !s.deliver(1, []byte("first")) || !s.deliver(1, []byte("duplicate")) {
		t.Fatal("first or duplicate frame rejected")
	}
	_, data, err := s.ReadMessage()
	if err != nil || string(data) != "first" {
		t.Fatal("duplicate frame replaced the first action")
	}
	if s.deliver(3, []byte("lost second frame")) {
		t.Fatal("sequence gap silently accepted")
	}
	block := bytes.Repeat([]byte("x"), 512<<10)
	for seq := uint64(2); seq <= 5; seq++ {
		if !s.deliver(seq, block) {
			t.Fatal("valid bounded input rejected")
		}
	}
	if s.deliver(6, []byte("overflow")) {
		t.Fatal("unbounded input queue")
	}
	s.Close()
	if _, _, err := s.ReadMessage(); err == nil {
		t.Fatal("closed connection executed queued input")
	}
	if s.deliver(6, nil) {
		t.Fatal("closed connection accepted input")
	}
}

func TestClusterSocketReadDeadlineAndFrameLimit(t *testing.T) {
	s := newClusterSocket(roomBinding{}, func(roomBinding, []byte, bool, time.Time) error { return nil })
	defer s.Close()
	s.SetReadLimit(4)
	s.deliver(1, []byte("large"))
	if _, _, err := s.ReadMessage(); err == nil {
		t.Fatal("read limit ignored")
	}
	s.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
	if _, _, err := s.ReadMessage(); err == nil {
		t.Fatal("deadline ignored")
	}
}

func TestPartyTransportRejectsRegressingStateAndClock(t *testing.T) {
	var last uint64
	if !freshPartyMessage([]byte(`{"type":"state","revision":5}`), &last) || last != 5 {
		t.Fatal("fresh state rejected")
	}
	for _, body := range []string{`{"type":"state","revision":4}`, `{"type":"state","revision":5}`, `{"type":"media_clock","stateRevision":4}`} {
		if freshPartyMessage([]byte(body), &last) {
			t.Fatal("stale state or clock accepted")
		}
	}
	if !freshPartyMessage([]byte(`{"type":"media_clock","stateRevision":5}`), &last) {
		t.Fatal("current media clock rejected")
	}
}
