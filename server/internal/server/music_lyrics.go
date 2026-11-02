package server

import (
	"encoding/json"
	"html"
	"sort"
	"strings"
)

type providerLyricLine struct {
	MS       int64  `json:"milliseconds"`
	Duration int64  `json:"duration"`
	Line     string `json:"line"`
}
type providerWordLine struct {
	Start *int64 `json:"start"`
	End   *int64 `json:"end"`
	Words []struct {
		Start *int64 `json:"start"`
		End   *int64 `json:"end"`
		Word  string `json:"word"`
	} `json:"words"`
}
type providerLyrics struct {
	Lines []providerLyricLine `json:"synchronizedLines"`
	// A malformed optional word payload must not discard valid line lyrics.
	WordLines json.RawMessage `json:"synchronizedWordByWordLines"`
}

func lyricText(s string) string      { return strings.Join(strings.Fields(html.UnescapeString(s)), " ") }
func sameLyricText(a, b string) bool { return strings.EqualFold(lyricText(a), lyricText(b)) }

func nativeWordCue(line providerWordLine) (musicCue, bool) {
	if line.Start == nil || line.End == nil || *line.Start < 0 || *line.End <= *line.Start || *line.End > 86400000 || len(line.Words) == 0 || len(line.Words) > 300 {
		return musicCue{}, false
	}
	words := make([]musicWord, 0, len(line.Words))
	text := make([]string, 0, len(line.Words))
	for i, w := range line.Words {
		part := lyricText(w.Word)
		if w.Start == nil || w.End == nil || part == "" || len(part) > 1000 || *w.Start < *line.Start || *w.End > *line.End || *w.End <= *w.Start || i > 0 && *w.Start < *line.Words[i-1].End {
			return musicCue{}, false
		}
		text = append(text, part)
		if i+1 < len(line.Words) {
			part += " "
		}
		words = append(words, musicWord{StartMS: *w.Start, EndMS: *w.End, Text: part})
	}
	joined := strings.Join(text, " ")
	if len(joined) > 4000 {
		return musicCue{}, false
	}
	return musicCue{StartMS: *line.Start, EndMS: *line.End, Text: joined, Words: words}, true
}

func providerCues(lyrics *providerLyrics) []musicCue {
	base := []musicCue{}
	if lyrics == nil {
		return base
	}
	for _, line := range lyrics.Lines {
		text := lyricText(line.Line)
		if text != "" && len(text) <= 4000 && line.MS >= 0 && line.MS < 86400000 && line.Duration >= 0 && line.Duration <= 86400000 {
			base = append(base, musicCue{StartMS: line.MS, EndMS: min(line.MS+line.Duration, 86400000), Text: text})
		}
		if len(base) == 1500 {
			break
		}
	}
	sort.SliceStable(base, func(i, j int) bool { return base[i].StartMS < base[j].StartMS })
	dedup := base[:0]
	for _, cue := range base {
		if len(dedup) == 0 || cue.StartMS > dedup[len(dedup)-1].StartMS {
			dedup = append(dedup, cue)
		}
	}
	base = dedup
	for i := range base {
		if i+1 < len(base) && (base[i].EndMS <= base[i].StartMS || base[i].EndMS > base[i+1].StartMS) {
			base[i].EndMS = base[i+1].StartMS
		}
		if base[i].EndMS <= base[i].StartMS {
			base[i].EndMS = min(base[i].StartMS+4000, 86400000)
		}
	}
	var raw []providerWordLine
	if json.Unmarshal(lyrics.WordLines, &raw) != nil || len(raw) > 1500 {
		return base
	}
	native := make([]musicCue, 0, len(raw))
	for _, line := range raw {
		if cue, ok := nativeWordCue(line); ok {
			native = append(native, cue)
		}
	}
	// The full word source has its own, finer line boundaries. Adopt that
	// timeline only when it accounts for the complete original text in order.
	complete := len(native) > 0 && (len(base) == 0 || len(native) == len(base))
	for i := range native {
		if i > 0 && native[i].StartMS <= native[i-1].StartMS {
			complete = false
		}
		if len(base) > 0 && (i >= len(base) || !sameLyricText(native[i].Text, base[i].Text)) {
			complete = false
		}
	}
	if complete {
		return native
	}
	// Partial coverage may add real word boundaries inside an existing line.
	// Never invent missing words or move a partial source onto another chorus.
	for i := range base {
		for _, cue := range native {
			if cue.StartMS < base[i].StartMS || cue.EndMS > base[i].EndMS || !sameLyricText(cue.Text, base[i].Text) {
				continue
			}
			parts := strings.Fields(base[i].Text)
			if len(parts) != len(cue.Words) {
				continue
			}
			words := append([]musicWord(nil), cue.Words...)
			for j := range words {
				words[j].Text = parts[j]
				if j+1 < len(words) {
					words[j].Text += " "
				}
			}
			base[i].Words = words
			break
		}
	}
	return base
}

func lyricSync(cues []musicCue) string {
	words := 0
	for _, cue := range cues {
		if len(cue.Words) > 0 {
			words++
		}
	}
	if words == 0 {
		return "line"
	}
	if words == len(cues) {
		return "word"
	}
	return "mixed"
}
