package game

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func buzzerRoom(t *testing.T) (*Engine, *Room, *Player, *Player) {
	t.Helper()
	e := NewEngine(fakeCatalog{})
	r, _ := e.CreateRoom(CreateParams{Rounds: 1, RoundTypes: []RoundType{RoundMelody}, MelodyMode: "buzzer"})
	a, _ := e.Join(r, "Дівчина", TeamGirls, "")
	b, _ := e.Join(r, "Хлопець", TeamBoys, "")
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	return e, r, a, b
}

func TestBuzzerFirstClaimStopsAudioAndAwardsClaimingTeamOnce(t *testing.T) {
	e, r, a, b := buzzerRoom(t)
	if err := e.Apply(r, Action{Name: "buzz", Actor: b}); err == nil {
		t.Fatal("buzz before audio start")
	}
	_ = e.Apply(r, Action{Name: "resume", IsHost: true})
	r.Media.Wanted, r.Media.Playing = true, true
	if err := e.Apply(r, Action{Name: "buzz", Actor: b, Payload: map[string]any{"team": "girls"}}); err != nil {
		t.Fatal(err)
	}
	d := r.Current.Data.(*melodyData)
	deadline := r.Current.Deadline
	if d.Buzzer.Team != TeamBoys || d.Buzzer.Points != 3 || r.Media.Wanted || r.Media.Playing || time.Until(deadline) > melodyAnswerTime {
		t.Fatal("buzz did not claim for the actual team and stop music")
	}
	if err := e.Apply(r, Action{Name: "buzz", Actor: a}); err == nil || !r.Current.Deadline.Equal(deadline) || d.Buzzer.Attempt != 1 {
		t.Fatal("second buzz replaced the winner or extended the clock")
	}
	if err := e.Apply(r, Action{Name: "guess", Actor: a, Payload: map[string]any{"text": "Пісня"}}); err == nil {
		t.Fatal("other team answered")
	}
	public, _ := json.Marshal(BuildView(r, nil))
	if strings.Contains(string(public), "Пісня") || strings.Contains(string(public), "hostAnswer") {
		t.Fatal("buzzer revealed hidden song")
	}
	if err := e.Apply(r, Action{Name: "guess", Actor: b, Payload: map[string]any{"text": "Пісня"}}); err != nil {
		t.Fatal(err)
	}
	if r.Current.Result.Team != TeamBoys || r.Current.Result.Points != 3 || r.Teams[TeamBoys].Score != 3 || r.Teams[TeamGirls].Score != 0 {
		t.Fatal("claiming team lost its original points")
	}
	_ = e.Apply(r, Action{Name: "guess", Actor: b, Payload: map[string]any{"text": "Пісня"}})
	if r.Teams[TeamBoys].Score != 3 {
		t.Fatal("duplicate score")
	}
}

func TestBuzzerWrongAnswerAndTimeoutGiveOtherTeamOneChance(t *testing.T) {
	e, r, a, b := buzzerRoom(t)
	_ = e.Apply(r, Action{Name: "resume", IsHost: true})
	_ = e.Apply(r, Action{Name: "buzz", Actor: a})
	_ = e.Apply(r, Action{Name: "guess", Actor: a, Payload: map[string]any{"text": "невірна відповідь"}})
	d := r.Current.Data.(*melodyData)
	if r.Stage != StagePlaying || !r.Paused || d.Buzzer.Phase != "handoff" || !d.Buzzer.Blocked[TeamGirls] || !r.Current.Deadline.IsZero() {
		t.Fatal("wrong answer did not hand off safely")
	}
	if BuildView(r, nil).Round.(map[string]any)["song"] != nil {
		t.Fatal("handoff revealed song")
	}
	_ = e.Apply(r, Action{Name: "resume", IsHost: true})
	if err := e.Apply(r, Action{Name: "buzz", Actor: a}); err == nil {
		t.Fatal("losing team buzzed twice")
	}
	if err := e.Apply(r, Action{Name: "buzz", Actor: b}); err != nil {
		t.Fatal(err)
	}
	e.Timeout(r)
	if r.Stage != StageResult || r.Current.Result.Points != 0 {
		t.Fatal("both exhausted attempts did not close the round")
	}
}

func TestBuzzerAnswerPauseAndPrivateRestorePreserveBothClocks(t *testing.T) {
	e, r, _, b := buzzerRoom(t)
	_ = e.Apply(r, Action{Name: "resume", IsHost: true})
	_ = e.Apply(r, Action{Name: "buzz", Actor: b})
	listen := r.Current.Data.(*melodyData).Buzzer.ListenRemaining
	e.Pause(r)
	if !MelodyAnswerWindow(r) || r.Current.PausedRemaining > melodyAnswerTime {
		t.Fatal("answer pause lost its clock")
	}
	raw, err := Snapshot(r)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !restored.Paused || !MelodyAnswerWindow(restored) || restored.Current.Data.(*melodyData).Buzzer.ListenRemaining != listen {
		t.Fatal("restore lost listening or answer clock")
	}
	if err = e.Apply(restored, Action{Name: "resume", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	if time.Until(restored.Current.Deadline) > melodyAnswerTime || !MelodyAnswerWindow(restored) {
		t.Fatal("answer resume turned music on")
	}
	e.Timeout(restored)
	if restored.Stage != StagePlaying || !restored.Paused || restored.Current.Data.(*melodyData).Buzzer.Phase != "handoff" {
		t.Fatal("first timeout did not preserve the second chance")
	}
}

func TestHostCanSkipUnavailableMelodyWhilePaused(t *testing.T) {
	e, r, a, _ := buzzerRoom(t)
	if err := e.Apply(r, Action{Name: "end_melody", Actor: a}); err != ErrNotHost {
		t.Fatal("player skipped a paused round")
	}
	if err := e.Apply(r, Action{Name: "end_melody", IsHost: true}); err != nil {
		t.Fatal(err)
	}
	if r.Stage != StageResult || r.Paused || r.Current.Result.Points != 0 {
		t.Fatal("skip did not close the silent round")
	}
	if err := e.Apply(r, Action{Name: "next", IsHost: true}); err != nil || r.Stage != StageFinal || len(r.History) != 1 {
		t.Fatal("skipped round blocked the next transition")
	}
}
