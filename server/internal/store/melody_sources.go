package store

import (
	"encoding/json"

	"chtozverchu/internal/game"
)

// IDs and recording identities are curated from the provider, never signed
// preview URLs. The catalog identity guard preserves independently edited songs.
type melodySource struct {
	CatalogID   string `json:"catalogId"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	TrackID     int64  `json:"trackId"`
	TrackTitle  string `json:"trackTitle"`
	TrackArtist string `json:"trackArtist"`
}

var melodySources = func() map[string]melodySource {
	var seed struct {
		Tracks []melodySource `json:"tracks"`
	}
	if err := json.Unmarshal(seedMelodySources, &seed); err != nil {
		panic(err)
	}
	out := make(map[string]melodySource, len(seed.Tracks))
	for _, source := range seed.Tracks {
		out[source.CatalogID] = source
	}
	return out
}()

func sourceForSong(song game.Song) (melodySource, bool) {
	source, ok := melodySources[song.ID]
	return source, ok && source.Title == song.Title && source.Artist == song.Artist
}

// MelodySongs keeps unverified recordings out of automatic audio rounds.
// Other music contests retain the complete lyric catalog.
func (c *Catalog) MelodySongs(preset string) []game.Song {
	var songs []game.Song
	for _, song := range c.Songs(preset) {
		_, verified := sourceForSong(song)
		if verified || song.PreviewURL != "" {
			songs = append(songs, song)
		}
	}
	return songs
}
