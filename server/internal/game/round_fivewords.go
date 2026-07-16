package game

import "errors"

func init() { register(fiveWords{}) }

type fiveWords struct{}

type fiveWordsData struct {
	Song     Song
	Words    []string
	Revealed []bool
}

func (*fiveWordsData) Kind() RoundType { return RoundFiveWords }

func (fiveWords) Type() RoundType { return RoundFiveWords }

func (fiveWords) Start(room *Room, cat Catalog) (RoundData, error) {
	pool := songsWithPhrases(cat.Songs(room.Config.Preset))
	if len(pool) == 0 {
		return nil, ErrEmptyDeck
	}
	s := pool[pickRandom(len(pool))]
	phrase := s.Phrases[pickRandom(len(s.Phrases))]
	words := make([]string, 0, 5)
	for i := 0; i < 5 && i < len(phrase); i++ {
		words = append(words, phrase[i])
	}
	for len(words) < 5 {
		words = append(words, "")
	}
	return &fiveWordsData{
		Song:     s,
		Words:    words,
		Revealed: make([]bool, 5),
	}, nil
}

func (fiveWords) Action(room *Room, act Action) error {
	d, ok := room.Current.Data.(*fiveWordsData)
	if !ok {
		return ErrNoRound
	}
	if room.Stage != StagePlaying {
		return ErrBadStage
	}
	switch act.Name {
	case "reveal":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		idx, ok := act.Int("index")
		if ok && idx >= 0 && idx < 5 {
			d.Revealed[idx] = true
		}
		if allTrue(d.Revealed) {
			resolveFiveWords(room, d, false, "")
		}
		return nil
	case "revealRandom":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		closed := closedIndexes(d.Revealed)
		if len(closed) > 0 {
			d.Revealed[closed[pickRandom(len(closed))]] = true
		}
		if allTrue(d.Revealed) {
			resolveFiveWords(room, d, false, "")
		}
		return nil
	case "guess":
		if !activeOrHost(room, act) {
			return errors.New("зараз не ваша черга")
		}
		if !anyTrue(d.Revealed) {
			return errors.New("спершу відкрийте хоча б одне слово")
		}
		guess := act.Str("text")
		won := matchesFiveWords(guess, d)
		resolveFiveWords(room, d, won, guess)
		return nil
	case "force":
		if !act.IsHost {
			return ErrNotHost
		}
		resolveFiveWords(room, d, act.Bool("won"), act.Str("text"))
		return nil
	}
	return errors.New("невідома дія")
}

func resolveFiveWords(room *Room, d *fiveWordsData, won bool, guess string) {
	pts := 0
	if won {
		pts = fiveWordsPoints(d)
		room.Teams[room.ActiveTeam].Score += pts
	}
	room.Current.Result = &RoundResult{
		Won:    won,
		Points: pts,
		Team:   room.ActiveTeam,
		Answer: room.Current.Data.(*fiveWordsData).Song.Title,
		Detail: guess,
	}
	room.Stage = StageResult
}

func fiveWordsPoints(d *fiveWordsData) int {
	revealed := 0
	for _, r := range d.Revealed {
		if r {
			revealed++
		}
	}
	p := 5 - revealed
	if p < 0 {
		return 0
	}
	return p
}

func matchesFiveWords(guess string, d *fiveWordsData) bool {
	// Match the full phrase, the currently-hidden words, the song title or aliases.
	full := joinWords(d.Words, nil)
	hidden := joinWords(d.Words, d.Revealed)
	cands := []string{full, hidden, d.Song.Title}
	cands = append(cands, d.Song.Aliases...)
	return matchesAny(guess, cands...)
}

func (fiveWords) View(room *Room, viewer *Player) any {
	d, ok := room.Current.Data.(*fiveWordsData)
	if !ok {
		return nil
	}
	done := room.Stage == StageResult
	slots := make([]map[string]any, 5)
	for i := range d.Words {
		if i >= 5 {
			break
		}
		open := d.Revealed[i] || done
		slot := map[string]any{"revealed": open}
		if open {
			slot["word"] = d.Words[i]
		}
		slots[i] = slot
	}
	out := map[string]any{
		"slots":     slots,
		"potential": fiveWordsPoints(d),
	}
	if done {
		out["song"] = map[string]any{
			"title":      d.Song.Title,
			"artist":     d.Song.Artist,
			"youtube":    d.Song.YouTube,
			"previewUrl": d.Song.PreviewURL,
		}
		out["phrase"] = d.Words
	}
	return out
}

// ---- helpers ----

func songsWithPhrases(all []Song) []Song {
	out := all[:0:0]
	for _, s := range all {
		if len(s.Phrases) > 0 {
			out = append(out, s)
		}
	}
	return out
}

func allTrue(bs []bool) bool {
	for _, b := range bs {
		if !b {
			return false
		}
	}
	return true
}

func anyTrue(bs []bool) bool {
	for _, b := range bs {
		if b {
			return true
		}
	}
	return false
}

func closedIndexes(bs []bool) []int {
	var out []int
	for i, b := range bs {
		if !b {
			out = append(out, i)
		}
	}
	return out
}

// joinWords joins the words; if mask is provided only words where mask[i] is
// false are included (the still-hidden words).
func joinWords(words []string, mask []bool) string {
	var parts []string
	for i, w := range words {
		if w == "" {
			continue
		}
		if mask != nil && i < len(mask) && mask[i] {
			continue
		}
		parts = append(parts, w)
	}
	return joinSpace(parts)
}

func joinSpace(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " "
		}
		out += p
	}
	return out
}
