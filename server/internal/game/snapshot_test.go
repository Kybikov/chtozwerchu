package game

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPrivateSnapshotRestoresAllContestTypes(t *testing.T) {
	for _, kind := range []RoundType{RoundFiveWords, RoundMelody, RoundAlias, RoundCrocodile, RoundTruthLie} {
		e, r := newTestRoom(t, kind)
		if r.Paused {
			_ = e.Apply(r, Action{Name: "resume", IsHost: true})
		}
		if kind == RoundAlias {
			_ = e.Apply(r, Action{Name: "correct", IsHost: true})
		}
		before := BuildView(r, r.Players[0])
		raw, err := Snapshot(r)
		if err != nil {
			t.Fatal(err)
		}
		restored, err := RestoreSnapshot(raw)
		if err != nil {
			t.Fatal(err)
		}
		after := BuildView(restored, restored.Players[0])
		b, _ := json.Marshal(before.Round)
		a, _ := json.Marshal(after.Round)
		if string(a) != string(b) || restored.MatchID != r.MatchID || restored.Players[0].Token != r.Players[0].Token {
			t.Fatalf("%s state or capabilities changed", kind)
		}
		if !restored.Paused || !restored.Current.Deadline.IsZero() || restored.Players[0].Connected {
			t.Fatal("restored room resumed unattended")
		}
		_ = e.Apply(restored, Action{Name: "resume", IsHost: true})
		if restored.Paused {
			t.Fatal("host could not resume restored game")
		}
		if kind != RoundFiveWords && time.Until(restored.Current.Deadline) < time.Second {
			t.Fatal("timer lost on restore")
		}
	}
}
