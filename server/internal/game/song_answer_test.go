package game

import "testing"

func TestNormalizeUkrainianApostrophes(t *testing.T) {
	for _, word := range []string{"п'ять слів", "п’ять слів", "пʼять слів", "пʻять слів"} {
		if got := normalize(word); got != "пять слів" {
			t.Errorf("normalize(%q) = %q", word, got)
		}
	}
}

func TestSongTitleAndArtistMatching(t *testing.T) {
	song := Song{Title: "Уночі", Artist: "YAKTAK", Aliases: []string{"Unoci"}}
	for _, tc := range []struct {
		guess string
		want  bool
	}{
		{"Уночі", true},
		{"  УНОЧІ!  ", true},
		{"unoci", true},
		{"Уночі — YAKTAK", true},
		{"YAKTAK — Уночі", true},
		{"Уночі-YAKTAK", true},
		{"YAKTAK/Уночі", true},
		{"Уночі : YAKTAK", true},
		{"", false},
		{"YAKTAK", false},
		{"Уно", false},
		{"Інша пісня — YAKTAK", false},
		{"Уночі — Інший гурт", false},
		{"Можливо, Уночі — YAKTAK", false},
	} {
		t.Run(tc.guess, func(t *testing.T) {
			if got := matchesSongTitle(tc.guess, song); got != tc.want {
				t.Fatalf("matchesSongTitle(%q) = %v, want %v", tc.guess, got, tc.want)
			}
		})
	}

	for _, song := range []Song{{Artist: "Гурт"}, {Title: "Пісня"}} {
		if matchesSongTitle("Гурт", song) {
			t.Fatal("incomplete metadata accepted an artist as the song title")
		}
	}
	spaced := Song{Title: "П'ять слів", Artist: "Океан Ельзи"}
	if !matchesSongTitle("ОКЕАН ЕЛЬЗИ—ПʼЯТЬ СЛІВ", spaced) {
		t.Fatal("full answer lost existing apostrophe and punctuation normalization")
	}
}
