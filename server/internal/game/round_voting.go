package game

import "errors"

// The electorate is frozen when a round starts. A reconnect keeps the same
// player identity and vote; leaving cannot manufacture a new majority.
type TeamPoll struct {
	Eligible []string
	Choices  map[string]bool
}
type VoteResult struct {
	Eligible int    `json:"eligible"`
	Cast     int    `json:"cast"`
	Truth    int    `json:"truth"`
	Lie      int    `json:"lie"`
	Decision *bool  `json:"decision,omitempty"`
	Outcome  string `json:"outcome"`
}
type VoteView struct {
	Mode     string      `json:"mode"`
	Eligible int         `json:"eligible"`
	Cast     int         `json:"cast"`
	CanVote  bool        `json:"canVote"`
	YourVote *bool       `json:"yourVote,omitempty"`
	Result   *VoteResult `json:"result,omitempty"`
	Fallback bool        `json:"fallback,omitempty"`
}

func newTeamPoll(room *Room, team Team) *TeamPoll {
	p := &TeamPoll{Choices: map[string]bool{}}
	for _, player := range room.Players {
		if player.Team == team && player.Connected && !player.IsHost {
			p.Eligible = append(p.Eligible, player.ID)
		}
	}
	return p
}
func (p *TeamPoll) eligible(id string) bool {
	for _, v := range p.Eligible {
		if v == id {
			return true
		}
	}
	return false
}
func (p *TeamPoll) cast(actor *Player, choice bool) error {
	if actor == nil || !p.eligible(actor.ID) {
		return errors.New("Цього раунду голосують підключені на його початку гравці активної команди.")
	}
	if p.Choices == nil {
		p.Choices = map[string]bool{}
	}
	p.Choices[actor.ID] = choice
	return nil
}
func (p *TeamPoll) result() *VoteResult {
	r := &VoteResult{Eligible: len(p.Eligible), Cast: len(p.Choices)}
	for _, choice := range p.Choices {
		if choice {
			r.Truth++
		} else {
			r.Lie++
		}
	}
	switch {
	case r.Cast == 0:
		r.Outcome = "empty"
	case r.Truth == r.Lie:
		r.Outcome = "tie"
	default:
		r.Outcome = "majority"
		choice := r.Truth > r.Lie
		r.Decision = &choice
	}
	return r
}
func (p *TeamPoll) view(viewer *Player, done bool) VoteView {
	v := VoteView{Mode: "players", Eligible: len(p.Eligible), Cast: len(p.Choices)}
	if viewer != nil && p.eligible(viewer.ID) {
		v.CanVote = !done
		if choice, ok := p.Choices[viewer.ID]; ok {
			v.YourVote = &choice
		}
	}
	// Only participation counts are public while voting remains open.
	if done {
		v.Result = p.result()
	}
	return v
}
