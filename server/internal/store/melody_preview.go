package store

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"chtozverchu/internal/game"
)

type previewEntry struct {
	url     string
	expires time.Time
}
type previewFlight struct {
	done chan struct{}
	url  string
	err  error
}
type previewResolver struct {
	client  *http.Client
	baseURL string
	mu      sync.Mutex
	cache   map[int64]previewEntry
	flights map[int64]*previewFlight
}

var melodyPreviews = &previewResolver{client: deezerHTTP, baseURL: "https://api.deezer.com"}

// SongPreview resolves a verified recording directly. Only short-lived public
// metadata is cached; audio, account credentials and signed URLs stay out of git.
func SongPreview(ctx context.Context, song game.Song) (string, error) {
	if source, ok := sourceForSong(song); ok {
		return melodyPreviews.lookup(ctx, source)
	}
	return DeezerPreview(ctx, song.Title, song.Artist)
}

func (r *previewResolver) lookup(ctx context.Context, source melodySource) (string, error) {
	r.mu.Lock()
	if entry := r.cache[source.TrackID]; entry.url != "" && time.Now().Before(entry.expires) {
		r.mu.Unlock()
		return entry.url, nil
	}
	if flight := r.flights[source.TrackID]; flight != nil {
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-flight.done:
			return flight.url, flight.err
		}
	}
	if r.cache == nil {
		r.cache = map[int64]previewEntry{}
	}
	if r.flights == nil {
		r.flights = map[int64]*previewFlight{}
	}
	flight := &previewFlight{done: make(chan struct{})}
	r.flights[source.TrackID] = flight
	r.mu.Unlock()

	preview, err := r.fetch(ctx, source)
	if err != nil && ctx.Err() == nil {
		// Provider timeouts/rate limits must not become a permanent catalog miss.
		select {
		case <-ctx.Done():
			err = ctx.Err()
		case <-time.After(250 * time.Millisecond):
			preview, err = r.fetch(ctx, source)
		}
	}
	r.mu.Lock()
	if err == nil && preview != "" {
		r.cache[source.TrackID] = previewEntry{preview, previewExpiry(preview)}
	}
	flight.url, flight.err = preview, err
	delete(r.flights, source.TrackID)
	close(flight.done)
	r.mu.Unlock()
	return preview, err
}

func (r *previewResolver) fetch(ctx context.Context, source melodySource) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+"/track/"+strconv.FormatInt(source.TrackID, 10), nil)
	if err != nil {
		return "", err
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("deezer status %d", resp.StatusCode)
	}
	var track struct {
		ID       int64  `json:"id"`
		Title    string `json:"title"`
		Readable bool   `json:"readable"`
		Preview  string `json:"preview"`
		Artist   struct {
			Name string `json:"name"`
		} `json:"artist"`
		Error json.RawMessage `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&track); err != nil {
		return "", fmt.Errorf("invalid deezer metadata")
	}
	if len(track.Error) > 0 && string(track.Error) != "null" {
		return "", fmt.Errorf("deezer metadata unavailable")
	}
	if track.ID != source.TrackID || track.Title != source.TrackTitle || track.Artist.Name != source.TrackArtist {
		return "", fmt.Errorf("deezer recording identity changed")
	}
	if !track.Readable || track.Preview == "" {
		return "", nil
	}
	u, err := url.Parse(track.Preview)
	if err != nil || u.Scheme != "https" || !(strings.HasSuffix(u.Hostname(), ".dzcdn.net") || strings.HasSuffix(u.Hostname(), ".deezer.com")) {
		return "", fmt.Errorf("invalid deezer preview URL")
	}
	return track.Preview, nil
}

func previewExpiry(preview string) time.Time {
	expires := time.Now().Add(2 * time.Minute)
	if u, err := url.Parse(preview); err == nil {
		for _, part := range strings.Split(u.Query().Get("hdnea"), "~") {
			if strings.HasPrefix(part, "exp=") {
				if epoch, err := strconv.ParseInt(strings.TrimPrefix(part, "exp="), 10, 64); err == nil {
					if signed := time.Unix(epoch, 0).Add(-30 * time.Second); signed.Before(expires) {
						expires = signed
					}
				}
			}
		}
	}
	return expires
}
