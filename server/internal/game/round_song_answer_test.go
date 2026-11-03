package game

import "testing"

func TestFullSongAnswerAwardsActivePlayerOnce(t *testing.T) {
	for _, tc := range []struct {
		name  string
		kind  RoundType
		mode  string
		guess string
		want  int
	}{
		{"melody by turns", RoundMelody, "team", "Пісня — Гурт", 3},
		{"melody buzzer", RoundMelody, "buzzer", "Пісня — Гурт", 3},
		{"five words", RoundFiveWords, "team", "Пісня — Гурт", 4},
		{"melody artist only", RoundMelody, "team", "Гурт", 3},
		{"buzzer artist only", RoundMelody, "buzzer", "Гурт", 3},
		{"five words still needs song or phrase", RoundFiveWords, "team", "Гурт", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := NewEngine(fakeCatalog{})
			r, _ := e.CreateRoom(CreateParams{HostTeam: TeamGirls, Rounds: 1, RoundTypes: []RoundType{tc.kind}, MelodyMode: tc.mode})
			player, err := e.Join(r, "Гравець", TeamGirls, "")
			if err != nil {
				t.Fatal(err)
			}
			if err = e.StartGame(r); err != nil {
				t.Fatal(err)
			}
			if tc.kind == RoundFiveWords {
				err = e.Apply(r, Action{Name: "reveal", Actor: player, Payload: map[string]any{"index": float64(0)}})
			} else {
				err = e.Apply(r, Action{Name: "resume", IsHost: true})
			}
			if err != nil {
				t.Fatal(err)
			}
			if tc.mode == "buzzer" {
				if err = e.Apply(r, Action{Name: "buzz", Actor: player}); err != nil {
					t.Fatal(err)
				}
			}
			answer := Action{Name: "guess", Actor: player, Payload: map[string]any{"text": tc.guess}}
			if err = e.Apply(r, answer); err != nil {
				t.Fatal(err)
			}
			if r.Stage != StageResult || r.Current.Result == nil || r.Current.Result.Won != (tc.want > 0) || r.Current.Result.Team != TeamGirls || r.Teams[TeamGirls].Score != tc.want || r.Teams[TeamBoys].Score != 0 {
				t.Fatalf("complete song answer was not awarded: stage=%s result=%+v scores=%+v", r.Stage, r.Current.Result, r.Teams)
			}
			_ = e.Apply(r, answer)
			if r.Teams[TeamGirls].Score != tc.want {
				t.Fatal("repeated answer awarded points twice")
			}
		})
	}
}
