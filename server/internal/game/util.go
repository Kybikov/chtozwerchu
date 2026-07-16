package game

import (
	"strings"
	"unicode"
)

// normalize lowercases, strips punctuation/apostrophes and collapses spaces so
// that guesses can be compared forgivingly.
func normalize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevSpace := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsNumber(r):
			b.WriteRune(r)
			prevSpace = false
		case unicode.IsSpace(r):
			if !prevSpace && b.Len() > 0 {
				b.WriteRune(' ')
				prevSpace = true
			}
		default:
			// drop apostrophes, punctuation, etc.
		}
	}
	return strings.TrimSpace(b.String())
}

// matchesAny reports whether the guess normalizes to any of the candidates.
func matchesAny(guess string, candidates ...string) bool {
	g := normalize(guess)
	if g == "" {
		return false
	}
	for _, c := range candidates {
		if normalize(c) == g {
			return true
		}
	}
	return false
}

// pickRandom returns a random element index for a slice of length n (0 if empty).
func pickRandom(n int) int {
	if n <= 0 {
		return 0
	}
	return randInt(n)
}

// activeOrHost reports whether the actor may act for the active team.
func activeOrHost(room *Room, act Action) bool {
	if act.IsHost {
		return true
	}
	return act.Actor != nil && act.Actor.Team == room.ActiveTeam
}
