package game

import (
	"encoding/json"
	"testing"
)

func votingRoom(t *testing.T, n int) (*Engine, *Room, []*Player) {
	t.Helper()
	e := NewEngine(fakeCatalog{})
	r, _ := e.CreateRoom(CreateParams{Rounds: 1, RoundTypes: []RoundType{RoundTruthLie}, VoteMode: "players"})
	var voters []*Player
	for i := 0; i < n; i++ {
		p, err := e.Join(r, string(rune('A'+i)), TeamGirls, "")
		if err != nil {
			t.Fatal(err)
		}
		voters = append(voters, p)
	}
	if err := e.StartGame(r); err != nil {
		t.Fatal(err)
	}
	return e, r, voters
}
func TestCollectiveVoteKeepsChoicesPrivateAndScoresMajorityOnce(t *testing.T) {
	e, r, voters := votingRoom(t, 3)
	vote := func(p *Player, b bool) error {
		return e.Apply(r, Action{Name: "vote", Actor: p, IsHost: p.IsHost, Payload: map[string]any{"truth": b}})
	}
	if vote(r.Players[0], true) == nil {
		t.Fatal("host voted for a connected team")
	}
	if vote(&Player{ID: "opponent", Team: TeamBoys}, true) == nil {
		t.Fatal("opponent voted")
	}
	if err := vote(voters[0], false); err != nil {
		t.Fatal(err)
	}
	if err := vote(voters[0], true); err != nil {
		t.Fatal(err)
	} // replacement, not a second vote
	if r.Stage != StagePlaying {
		t.Fatal("first vote closed collective round")
	}
	public := BuildView(r, nil).Round.(map[string]any)["voting"].(VoteView)
	if public.Cast != 1 || public.Result != nil || public.YourVote != nil {
		t.Fatal("votes leaked or were counted twice")
	}
	own := BuildView(r, voters[0]).Round.(map[string]any)["voting"].(VoteView)
	if own.YourVote == nil || !*own.YourVote {
		t.Fatal("own vote missing")
	}
	raw, _ := Snapshot(r)
	restored, err := RestoreSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Current.Data.(*truthLieData).Poll.Choices[voters[0].ID] != true {
		t.Fatal("restart lost own vote")
	}
	_ = vote(voters[1], false)
	_ = vote(voters[2], true)
	if r.Stage != StageResult || r.Teams[TeamGirls].Score != 2 || r.Current.Result.Voting.Truth != 2 {
		t.Fatal("majority was not resolved")
	}
	_ = vote(voters[2], true)
	if r.Teams[TeamGirls].Score != 2 {
		t.Fatal("score duplicated")
	}
	wire, _ := json.Marshal(BuildView(r, nil))
	if len(wire) == 0 {
		t.Fatal("result not serializable")
	}
}
func TestCollectiveTieAndDeadline(t *testing.T) {
	e, r, v := votingRoom(t, 2)
	_ = e.Apply(r, Action{Name: "vote", Actor: v[0], Payload: map[string]any{"truth": true}})
	_ = e.Apply(r, Action{Name: "vote", Actor: v[1], Payload: map[string]any{"truth": false}})
	if r.Current.Result.Voting.Outcome != "tie" || r.Current.Result.Points != 0 {
		t.Fatal("tie awarded points")
	}
	e, r, v = votingRoom(t, 3)
	_ = e.Apply(r, Action{Name: "vote", Actor: v[0], Payload: map[string]any{"truth": true}})
	e.Timeout(r)
	if r.Stage != StageResult || r.Current.Result.Voting.Cast != 1 || r.Current.Result.Points != 2 {
		t.Fatal("deadline did not count the submitted votes")
	}
	e, r, _ = votingRoom(t, 2)
	e.Timeout(r)
	if r.Current.Result.Voting.Outcome != "empty" || r.Current.Result.Points != 0 {
		t.Fatal("empty vote awarded points")
	}
}
