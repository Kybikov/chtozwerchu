package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// deezerHTTP is the client used for preview lookups. Proxy settings are taken
// from the environment automatically.
var deezerHTTP = &http.Client{Timeout: 6 * time.Second}

// DeezerPreview looks up a 30-second preview MP3 URL for a track. Returns an
// empty string (no error) when nothing suitable is found.
func DeezerPreview(ctx context.Context, title, artist string) (string, error) {
	// Catalog artists can include a featured performer or use Ukrainian names
	// while Deezer uses Latin names. Search the title and verify both identities.
	endpoint := "https://api.deezer.com/search?limit=12&q=" + url.QueryEscape(title)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	resp, err := deezerHTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("deezer status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return matchingDeezerPreview(body, title, artist), nil
}

func musicIdentity(s string) string {
	translit := map[rune]string{'а': "a", 'б': "b", 'в': "v", 'г': "h", 'ґ': "g", 'д': "d", 'е': "e", 'є': "ie", 'ж': "zh", 'з': "z", 'и': "y", 'і': "i", 'ї': "i", 'й': "i", 'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f", 'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "shch", 'ь': "", 'ю': "iu", 'я': "ia"}
	var out strings.Builder
	for _, r := range strings.ToLower(s) {
		if t, ok := translit[r]; ok {
			out.WriteString(t)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
		}
	}
	return out.String()
}
func matchingDeezerPreview(body []byte, title, artist string) string {
	var payload struct {
		Data []struct {
			Title   string `json:"title"`
			Preview string `json:"preview"`
			Artist  struct {
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return ""
	}
	head := strings.FieldsFunc(artist, func(r rune) bool { return r == '&' || r == ',' || r == '/' })
	artistKey := musicIdentity(artist)
	if len(head) > 0 {
		artistKey = musicIdentity(head[0])
	}
	for _, t := range payload.Data {
		if t.Preview == "" || musicIdentity(t.Title) != musicIdentity(title) {
			continue
		}
		provider := musicIdentity(t.Artist.Name)
		// Allow small transliteration suffix differences, never a different artist.
		related := provider == artistKey || len(provider) >= 5 && len(artistKey) >= 5 && (strings.HasPrefix(provider, artistKey) || strings.HasPrefix(artistKey, provider))
		if related {
			return t.Preview
		}
	}
	return ""
}

// parseDeezerPreview extracts the first preview URL from a Deezer search body.
func parseDeezerPreview(body []byte) string {
	var payload struct {
		Data []struct {
			Preview string `json:"preview"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	for _, d := range payload.Data {
		if d.Preview != "" {
			return d.Preview
		}
	}
	return ""
}
