package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// deezerHTTP is the client used for preview lookups. Proxy settings are taken
// from the environment automatically.
var deezerHTTP = &http.Client{Timeout: 6 * time.Second}

// DeezerPreview looks up a 30-second preview MP3 URL for a track. Returns an
// empty string (no error) when nothing suitable is found.
func DeezerPreview(ctx context.Context, title, artist string) (string, error) {
	q := title
	if artist != "" {
		q = artist + " " + title
	}
	endpoint := "https://api.deezer.com/search?limit=1&q=" + url.QueryEscape(q)
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
	return parseDeezerPreview(body), nil
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
