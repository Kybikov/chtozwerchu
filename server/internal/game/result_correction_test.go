package game

import "testing"

func resolvedCorrectionRoom(t *testing.T, kind RoundType) (*Engine, *Room) {
	t.Helper()
	e, r := newTestRoom(t, kind)
	if r.Paused {
		if err := e.Apply(r, Action{Name: "resume", IsHost: true}); err != nil {
			t.Fatal(err)
		}
	}
	if kind == RoundFiveWords {
		if err := e.Apply(r, Action{Name: "reveal", IsHost: true, Payload: map[string]any{"index": 0}}); err != nil {
			t.Fatal(err)
		}
	}
	if kind == RoundAlias {
		if err := e.Apply(r, Action{Name: "correct", IsHost: true}); err != nil {
			t.Fatal(err)
		}
		if err := e.Apply(r, Action{Name: "end", IsHost: true}); err != nil {
			t.Fatal(err)
		}
	} else if err := e.Apply(r, Action{Name: "force", IsHost: true, Payload: map[string]any{"won": true}}); err != nil {
		t.Fatal(err)
	}
	return e, r
}
func correctionAction(round, revision, points int, team Team) Action {
	return Action{Name: "amend_result", Round: round, IsHost: true, Payload: map[string]any{"revision": revision, "points": points, "team": string(team)}}
}

func TestCorrectionTransfersOneAwardAndFinalizesHistory(t *testing.T) {
	for _, tc := range []struct {
		kind  RoundType
		limit int
	}{{RoundFiveWords, 4}, {RoundMelody, 3}, {RoundAlias, 2}, {RoundCrocodile, 3}, {RoundTruthLie, 2}} {
		t.Run(string(tc.kind), func(t *testing.T) {
			e, r := resolvedCorrectionRoom(t, tc.kind)
			original := *r.Current.Result
			view := BuildView(r, nil)
			if view.Result.AwardLimit != tc.limit || r.Current.Result.AwardLimit != 0 {
				t.Fatal("limit missing or public view mutated stored result")
			}
			if err := e.Apply(r, correctionAction(1, 0, 1, TeamBoys)); err != nil {
				t.Fatal(err)
			}
			result := r.Current.Result
			if r.Teams[TeamGirls].Score != 0 || r.Teams[TeamBoys].Score != 1 || r.ActiveTeam != TeamGirls || result.Team != TeamBoys || !result.Won {
				t.Fatal("transfer changed wrong score or play order")
			}
			if result.Answer != original.Answer || result.Detail != original.Detail || result.Voting != original.Voting || result.OriginalAward.Points != original.Points || result.OriginalAward.Team != TeamGirls {
				t.Fatal("answer or original award lost")
			}
			if err := e.Next(r); err != nil {
				t.Fatal(err)
			}
			if r.Stage != StageFinal || len(r.History) != 1 || r.History[0].Result.Points != 1 || r.History[0].Result.CorrectionRevision != 1 || Winner(r) != TeamBoys {
				t.Fatal("final history or winner does not use corrected award")
			}
			if e.Apply(r, correctionAction(1, 1, 2, TeamGirls)) == nil {
				t.Fatal("final result was edited")
			}
		})
	}
}

func TestCorrectionRejectsInvalidOrStaleRequestsAtomically(t *testing.T) {
	for _, name := range []string{"guest", "missing-round", "old-round", "missing-revision", "stale-revision", "negative", "fraction", "too-many", "bad-team", "fraction-revision"} {
		t.Run(name, func(t *testing.T) {
			e, r := resolvedCorrectionRoom(t, RoundFiveWords)
			a := correctionAction(1, 0, 2, TeamBoys)
			switch name {
			case "guest":
				a.IsHost = false
			case "missing-round":
				a.Round = 0
			case "old-round":
				a.Round = 2
			case "missing-revision":
				delete(a.Payload, "revision")
			case "stale-revision":
				a.Payload["revision"] = 1
			case "negative":
				a.Payload["points"] = -1
			case "fraction":
				a.Payload["points"] = 1.5
			case "too-many":
				a.Payload["points"] = 5
			case "bad-team":
				a.Payload["team"] = "everyone"
			case "fraction-revision":
				a.Payload["revision"] = 0.1
			}
			before := r.Revision
			if e.Apply(r, a) == nil {
				t.Fatal("invalid request accepted")
			}
			if r.Teams[TeamGirls].Score != 4 || r.Teams[TeamBoys].Score != 0 || r.Current.Result.CorrectionRevision != 0 || r.Current.Result.OriginalAward != nil || r.Revision != before {
				t.Fatal("rejected correction mutated state")
			}
		})
	}
}

func TestCorrectionDuplicatesAndRestartsDoNotDoubleCount(t *testing.T) {
	e, r := resolvedCorrectionRoom(t, RoundFiveWords)
	a := correctionAction(1, 0, 2, TeamBoys)
	if err := e.Apply(r, a); err != nil {
		t.Fatal(err)
	}
	if e.Apply(r, a) == nil || r.Teams[TeamBoys].Score != 2 {
		t.Fatal("duplicate award accepted")
	}
	raw, err := Snapshot(r)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.Apply(restored, correctionAction(1, 1, 0, TeamBoys)); err != nil {
		t.Fatal(err)
	}
	if restored.Teams[TeamGirls].Score != 0 || restored.Teams[TeamBoys].Score != 0 || restored.Current.Result.Won || restored.Current.Result.OriginalAward.Points != 4 || restored.Current.Result.CorrectionRevision != 2 {
		t.Fatal("restart lost correction ledger")
	}
	if err = e.Apply(restored, correctionAction(1, 2, 4, TeamGirls)); err != nil {
		t.Fatal(err)
	}
	if restored.Teams[TeamGirls].Score != 4 || restored.Teams[TeamBoys].Score != 0 {
		t.Fatal("restoring award inflated total")
	}
}

func TestCorrectionCanAwardAfterAnUnawardedResult(t *testing.T) {
	e, r := newTestRoom(t, RoundFiveWords)
	if err := e.Apply(r, Action{Name: "force", IsHost: true, Payload: map[string]any{"won": false}}); err != nil {
		t.Fatal(err)
	}
	if err := e.Apply(r, correctionAction(1, 0, 5, TeamBoys)); err != nil {
		t.Fatal(err)
	}
	if r.Teams[TeamGirls].Score != 0 || r.Teams[TeamBoys].Score != 5 || r.Current.Result.OriginalAward.Points != 0 {
		t.Fatal("unawarded result was not corrected")
	}
}
