package game

import (
	"errors"
	"time"
)

func init() { register(alias{}) }

type alias struct{}

// Duration is the countdown for an alias round.
func (alias) Duration() time.Duration { return 75 * time.Second }

// OnTimeout resolves the round when the countdown ends.
func (alias) OnTimeout(room *Room) {
	if d, ok := room.Current.Data.(*aliasData); ok {
		resolveAlias(room, d)
	}
}

type aliasData struct {
	Cards       []AliasCard
	Index       int
	ExplainerID string
	Scored      int
	Skipped     int
	GuessedIDs  []string
}

func (*aliasData) Kind() RoundType { return RoundAlias }

func (alias) Type() RoundType { return RoundAlias }

const aliasCardsPerRound = 8

func (alias) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := cat.AliasCards("")
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	cards := drawAlias(pool, aliasCardsPerRound)
	return &aliasData{
		Cards:       cards,
		ExplainerID: chooseExplainer(room),
	}, nil
}

func chooseExplainer(room *Room) string {
	// Prefer a connected player on the active team; fall back to the host.
	for _, p := range room.Players {
		if p.Team == room.ActiveTeam && p.Connected {
			return p.ID
		}
	}
	if h := room.host(); h != nil {
		return h.ID
	}
	return ""
}

func drawAlias(pool []AliasCard, n int) []AliasCard {
	if n > len(pool) {
		n = len(pool)
	}
	// simple shuffle-then-take
	idx := make([]int, len(pool))
	for i := range idx {
		idx[i] = i
	}
	for i := len(idx) - 1; i > 0; i-- {
		j := pickRandom(i + 1)
		idx[i], idx[j] = idx[j], idx[i]
	}
	out := make([]AliasCard, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, pool[idx[i]])
	}
	return out
}

func (alias) Action(room *Room, act Action) error {
	d, ok := room.Current.Data.(*aliasData)
	if !ok {
		return ErrNoRound
	}
	if room.Stage != StagePlaying {
		return ErrBadStage
	}
	switch act.Name {
	case "guess":
		// A guesser on the active team (not the explainer) submits a word.
		if act.Actor == nil || (act.Actor.Team != room.ActiveTeam && !act.IsHost) {
			return errors.New("вгадує команда, чия черга")
		}
		if act.Actor != nil && act.Actor.ID == d.ExplainerID {
			return errors.New("той, хто пояснює, не вгадує")
		}
		if d.Index >= len(d.Cards) {
			return nil
		}
		if matchesAny(act.Str("text"), d.Cards[d.Index].Word) {
			aliasScore(d)
		}
		return nil
	case "correct":
		// Explainer or host confirms the current word was guessed verbally.
		if !act.IsHost && (act.Actor == nil || act.Actor.ID != d.ExplainerID) {
			return errors.New("підтверджує лише той, хто пояснює")
		}
		aliasScore(d)
		return nil
	case "skip":
		if !act.IsHost && (act.Actor == nil || act.Actor.ID != d.ExplainerID) {
			return errors.New("пропускає лише той, хто пояснює")
		}
		if d.Index < len(d.Cards) {
			d.Skipped++
			d.Index++
		}
		if d.Index >= len(d.Cards) {
			resolveAlias(room, d)
		}
		return nil
	case "end":
		if !act.IsHost && (act.Actor == nil || act.Actor.ID != d.ExplainerID) {
			return ErrNotHost
		}
		resolveAlias(room, d)
		return nil
	}
	return errors.New("невідома дія")
}

func aliasScore(d *aliasData) {
	if d.Index >= len(d.Cards) {
		return
	}
	d.Scored++
	d.GuessedIDs = append(d.GuessedIDs, d.Cards[d.Index].ID)
	d.Index++
}

func resolveAlias(room *Room, d *aliasData) {
	room.Teams[room.ActiveTeam].Score += d.Scored
	room.Current.Result = &RoundResult{
		Won:    d.Scored > 0,
		Points: d.Scored,
		Team:   room.ActiveTeam,
		Answer: "Відгадано слів: " + itoa(d.Scored),
	}
	room.Stage = StageResult
}

func (alias) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*aliasData)
	if !ok {
		return nil
	}
	done := room.Stage == StageResult
	out := map[string]any{
		"scored":      d.Scored,
		"skipped":     d.Skipped,
		"total":       len(d.Cards),
		"index":       d.Index,
		"explainerId": d.ExplainerID,
	}
	explainer := room.playerByID(d.ExplainerID)
	if explainer != nil {
		out["explainerName"] = explainer.Name
	}
	// Only the explainer (and the host) see the current word to explain.
	isExplainer := viewer != nil && (viewer.ID == d.ExplainerID || viewer.IsHost)
	if !done && d.Index < len(d.Cards) && isExplainer {
		card := d.Cards[d.Index]
		out["current"] = map[string]any{
			"word":  card.Word,
			"taboo": card.Taboo,
		}
	}
	if done {
		words := make([]string, 0, len(d.Cards))
		for _, c := range d.Cards {
			words = append(words, c.Word)
		}
		out["cards"] = words
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
