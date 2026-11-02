package store

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestVerifiedMelodyCatalogPreservesLyricsAndEditedSongs(t *testing.T) {
	c, err := EmbeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	all, playable := c.Songs("party"), c.MelodySongs("party")
	if len(playable) != len(melodySources) || len(all) <= len(playable) {
		t.Fatal("audio filtering changed the lyric catalog")
	}
	ids := map[int64]bool{}
	for _, song := range playable {
		source, ok := sourceForSong(song)
		if !ok || source.TrackID <= 0 || source.TrackTitle == "" || source.TrackArtist == "" || ids[source.TrackID] {
			t.Fatalf("invalid recording for %s", song.ID)
		}
		ids[source.TrackID] = true
		song.Artist = "Independently edited performer"
		if _, ok := sourceForSong(song); ok {
			t.Fatal("applied bundled recording to edited content")
		}
	}
	for _, song := range all {
		if song.ID == "artem-pivovarov-dorofeeva-dumy" {
			if source, ok := sourceForSong(song); !ok || source.TrackID != 2004909277 {
				t.Fatal("duet did not resolve to verified recording")
			}
		}
	}
}

func previewFixture(w http.ResponseWriter, source melodySource, preview string) {
	_ = json.NewEncoder(w).Encode(map[string]any{"id": source.TrackID, "title": source.TrackTitle, "artist": map[string]string{"name": source.TrackArtist}, "readable": true, "preview": preview})
}

func TestPreviewCoalescesRequestsAndRefreshesExpiredSignatures(t *testing.T) {
	source := melodySources["artem-pivovarov-dorofeeva-dumy"]
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/track/"+strconv.FormatInt(source.TrackID, 10) {
			t.Error("searched instead of resolving the verified ID")
		}
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		previewFixture(w, source, "https://cdnt-preview.dzcdn.net/fixture.mp3")
	}))
	defer srv.Close()
	resolver := &previewResolver{client: srv.Client(), baseURL: srv.URL}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, err := resolver.lookup(context.Background(), source)
			if err != nil || u == "" {
				t.Error("preview resolution failed")
			}
		}()
	}
	<-started
	close(release)
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("concurrent rooms fetched the same recording repeatedly")
	}
	resolver.mu.Lock()
	resolver.cache[source.TrackID] = previewEntry{"expired", time.Now().Add(-time.Second)}
	resolver.mu.Unlock()
	_, _ = resolver.lookup(context.Background(), source)
	if calls.Load() != 2 {
		t.Fatal("expired metadata was reused")
	}
	soon := time.Now().Add(45 * time.Second).Unix()
	if expiry := previewExpiry(fmt.Sprintf("https://cdnt-preview.dzcdn.net/x?hdnea=exp=%d~acl=x", soon)); expiry.After(time.Unix(soon, 0).Add(-30 * time.Second)) {
		t.Fatal("cache outlives signed URL")
	}
}

func TestPreviewRetriesProviderFailureAndRejectsDifferentRecording(t *testing.T) {
	source := melodySources["kalush-orchestra-stefania"]
	var calls atomic.Int32
	var wrong atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			_, _ = w.Write([]byte(`{"error":{"code":4,"message":"quota"}}`))
			return
		}
		s := source
		if wrong.Load() {
			s.TrackArtist = "A tribute band"
		}
		previewFixture(w, s, "https://cdnt-preview.dzcdn.net/x.mp3")
	}))
	defer srv.Close()
	resolver := &previewResolver{client: srv.Client(), baseURL: srv.URL}
	if u, err := resolver.lookup(context.Background(), source); err != nil || u == "" || calls.Load() != 2 {
		t.Fatal("provider error became a missing song")
	}
	wrong.Store(true)
	resolver = &previewResolver{client: srv.Client(), baseURL: srv.URL}
	if u, err := resolver.lookup(context.Background(), source); err == nil || u != "" {
		t.Fatal("substituted different recording")
	}
}
