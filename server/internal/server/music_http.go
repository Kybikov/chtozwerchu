package server

// The studio's read-only Deezer adapter. Credentials are deployment environment
// variables; neither ARL nor JWT is returned to clients. Full protected media is
// deliberately not decrypted or cached. Audio previews are labelled as previews.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type musicCue struct {
	StartMS int64       `json:"startMs"`
	EndMS   int64       `json:"endMs"`
	Text    string      `json:"text"`
	Words   []musicWord `json:"words,omitempty"`
}
type musicWord struct {
	StartMS int64  `json:"startMs"`
	EndMS   int64  `json:"endMs"`
	Text    string `json:"text"`
}
type musicTrack struct {
	ID           int64      `json:"id"`
	Title        string     `json:"title"`
	Artist       string     `json:"artist"`
	Album        string     `json:"album"`
	Cover        string     `json:"cover"`
	Duration     float64    `json:"duration"`
	Preview      string     `json:"preview"`
	Link         string     `json:"link"`
	Cues         []musicCue `json:"cues"`
	LyricsStatus string     `json:"lyricsStatus"`
	LyricsSync   string     `json:"lyricsSync,omitempty"`
}
type musicAdapter struct {
	mu         sync.Mutex
	token, arl string
	http       *http.Client
	cache      map[string]musicCache
}
type musicCache struct {
	track musicTrack
	at    time.Time
}
type publicTrack struct {
	ID       int64   `json:"id"`
	Title    string  `json:"title"`
	Duration float64 `json:"duration"`
	Preview  string  `json:"preview"`
	Link     string  `json:"link"`
	Artist   struct {
		Name string `json:"name"`
	} `json:"artist"`
	Album struct {
		Title string `json:"title"`
		Cover string `json:"cover_medium"`
	} `json:"album"`
}

func (t publicTrack) view() musicTrack {
	return musicTrack{ID: t.ID, Title: t.Title, Artist: t.Artist.Name, Album: t.Album.Title, Cover: t.Album.Cover, Duration: t.Duration, Preview: t.Preview, Link: t.Link, Cues: []musicCue{}, LyricsStatus: "not_loaded"}
}

func (s *Server) registerMusicRoutes(mux *http.ServeMux) {
	a := &musicAdapter{token: strings.TrimSpace(os.Getenv("DEEZER_ACCESS_TOKEN")), arl: strings.TrimSpace(os.Getenv("DEEZER_ARL")), http: &http.Client{Timeout: 12 * time.Second}, cache: map[string]musicCache{}}
	mux.HandleFunc("GET /api/music/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		a.mu.Lock()
		configured := a.token != "" || a.arl != ""
		a.mu.Unlock()
		writeJSON(w, 200, map[string]any{"lyricsConfigured": configured, "audio": "preview", "sync": "line_and_word"})
	})
	mux.HandleFunc("GET /api/music/search", a.search)
	mux.HandleFunc("GET /api/music/track", a.track)
}
func (a *musicAdapter) get(ctx context.Context, endpoint string, dest any) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	res, err := a.http.Do(req)
	if err != nil {
		return errors.New("provider_unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("provider_unavailable")
	}
	return json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(dest)
}
func (a *musicAdapter) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 || len([]rune(q)) > 120 {
		writeJSON(w, 400, map[string]string{"error": "Введи від 2 до 120 символів."})
		return
	}
	var result struct {
		Data []publicTrack `json:"data"`
	}
	if a.get(r.Context(), "https://api.deezer.com/search?limit=8&q="+url.QueryEscape(q), &result) != nil {
		writeJSON(w, 502, map[string]string{"error": "Deezer не відповідає. Спробуй ще раз."})
		return
	}
	tracks := make([]musicTrack, 0, len(result.Data))
	for _, t := range result.Data {
		tracks = append(tracks, t.view())
	}
	writeJSON(w, 200, map[string]any{"tracks": tracks})
}

var trackID = regexp.MustCompile(`^[1-9][0-9]{0,14}$`)

func (a *musicAdapter) track(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if !trackID.MatchString(id) {
		writeJSON(w, 400, map[string]string{"error": "Некоректний ID треку."})
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	a.mu.Lock()
	cached, ok := a.cache[id]
	a.mu.Unlock()
	if ok && time.Since(cached.at) < 10*time.Minute {
		writeJSON(w, 200, cached.track)
		return
	}
	var p publicTrack
	if a.get(r.Context(), "https://api.deezer.com/track/"+id, &p) != nil || strconv.FormatInt(p.ID, 10) != id {
		writeJSON(w, 502, map[string]string{"error": "Трек недоступний. Обери інший або додай власний файл."})
		return
	}
	t := p.view()
	t.LyricsStatus = "unconfigured"
	token, err := a.access(r.Context())
	if err == nil {
		cues, status := a.lyrics(r.Context(), id, token)
		// Retry exactly once after provider rejection, only when ARL is configured.
		if status == "reauth_required" && a.arl != "" {
			a.mu.Lock()
			if a.token == token {
				a.token = ""
			}
			a.mu.Unlock()
			if refreshed, e := a.access(r.Context()); e == nil {
				cues, status = a.lyrics(r.Context(), id, refreshed)
			}
		}
		t.Cues = cues
		t.LyricsStatus = status
		if status == "ready" {
			t.LyricsSync = lyricSync(cues)
		}
	} else if err.Error() != "unconfigured" {
		t.LyricsStatus = "reauth_required"
	}
	if t.LyricsStatus == "ready" || t.LyricsStatus == "unavailable" {
		a.mu.Lock()
		if len(a.cache) >= 64 {
			a.cache = map[string]musicCache{}
		}
		a.cache[id] = musicCache{t, time.Now()}
		a.mu.Unlock()
	}
	writeJSON(w, 200, t)
}
func tokenFresh(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if json.Unmarshal(raw, &claims) != nil {
		return false
	}
	return claims.Exp > time.Now().Add(30*time.Second).Unix()
}
func (a *musicAdapter) access(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if tokenFresh(a.token) {
		return a.token, nil
	}
	if a.arl == "" {
		if a.token == "" {
			return "", errors.New("unconfigured")
		}
		return "", errors.New("reauth_required")
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://auth.deezer.com/login/arl?jo=p&rto=c&i=c", nil)
	req.AddCookie(&http.Cookie{Name: "arl", Value: a.arl})
	req.Header.Set("Origin", "https://www.deezer.com")
	req.Header.Set("Referer", "https://www.deezer.com/")
	res, err := a.http.Do(req)
	if err != nil {
		return "", errors.New("provider_unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", errors.New("reauth_required")
	}
	var body struct {
		JWT string `json:"jwt"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 256<<10)).Decode(&body) != nil || !tokenFresh(body.JWT) {
		return "", errors.New("reauth_required")
	}
	a.token = body.JWT
	return a.token, nil
}
func (a *musicAdapter) lyrics(ctx context.Context, id, token string) ([]musicCue, string) {
	cues, status := a.lyricsRequest(ctx, id, token, true)
	if status == "word_timing_unsupported" {
		return a.lyricsRequest(ctx, id, token, false)
	}
	return cues, status
}
func (a *musicAdapter) lyricsRequest(ctx context.Context, id, token string, withWords bool) ([]musicCue, string) {
	fields := `synchronizedLines{milliseconds duration line}`
	if withWords {
		fields += ` synchronizedWordByWordLines{start end words{start end word}}`
	}
	payload, _ := json.Marshal(map[string]any{"query": `query StudioLyrics($id:String!){track(trackId:$id){lyrics{` + fields + `}}}`, "variables": map[string]string{"id": id}})
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://pipe.deezer.com/api", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://www.deezer.com")
	req.Header.Set("Referer", "https://www.deezer.com/")
	res, err := a.http.Do(req)
	if err != nil {
		return []musicCue{}, "provider_unavailable"
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return []musicCue{}, "reauth_required"
	}
	if res.StatusCode != 200 {
		return []musicCue{}, "provider_unavailable"
	}
	var body struct {
		Data struct {
			Track struct {
				Lyrics *providerLyrics `json:"lyrics"`
			} `json:"track"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&body) != nil {
		return []musicCue{}, "provider_unavailable"
	}
	if len(body.Errors) > 0 {
		unsupported := false
		for _, e := range body.Errors {
			m := strings.ToLower(e.Message)
			if strings.Contains(m, "token") || strings.Contains(m, "unauth") {
				return []musicCue{}, "reauth_required"
			}
			if withWords && (strings.Contains(m, "synchronizedwordbyword") || strings.Contains(m, "cannot query field")) {
				unsupported = true
			}
		}
		if unsupported {
			return []musicCue{}, "word_timing_unsupported"
		}
		if body.Data.Track.Lyrics == nil || len(body.Data.Track.Lyrics.Lines) == 0 {
			return []musicCue{}, "provider_unavailable"
		}
		body.Data.Track.Lyrics.WordLines = nil
	}
	cues := providerCues(body.Data.Track.Lyrics)
	if len(cues) == 0 {
		return cues, "unavailable"
	}
	return cues, "ready"
}
