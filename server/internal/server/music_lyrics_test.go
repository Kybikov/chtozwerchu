package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

const originalWordLines = `[{"start":3912,"end":5087,"words":[{"start":3912,"end":3925,"word":"Лови"},{"start":4050,"end":4287,"word":"цей"},{"start":4387,"end":5087,"word":"ритм"}]}]`

func TestProviderWordTimelineReplacesOnlyTheCompleteMatchingText(t *testing.T) {
	l := &providerLyrics{Lines: []providerLyricLine{{MS: 0, Duration: 3540, Line: "Лови цей ритм"}}, WordLines: json.RawMessage(originalWordLines)}
	cues := providerCues(l)
	if len(cues) != 1 || cues[0].StartMS != 3912 || cues[0].EndMS != 5087 || len(cues[0].Words) != 3 || cues[0].Words[0].EndMS != 3925 || cues[0].Words[1].StartMS != 4050 || cues[0].Words[2].StartMS != 4387 || cues[0].Text != "Лови цей ритм" {
		t.Fatal("native word boundaries or deliberate gaps changed")
	}
	if lyricSync(cues) != "word" {
		t.Fatal("complete native words not reported")
	}
	s := studioFixture()
	s.Track.Cues = cues
	if validateStudioTrack(s.Track) != nil {
		t.Fatal("native timeline is incompatible with the room")
	}
	l.Lines = nil
	if cues := providerCues(l); len(cues) != 1 || len(cues[0].Words) != 3 {
		t.Fatal("word-only provider source was discarded")
	}
}

func TestPartialWordCoverageKeepsAllOriginalLinesAndTheirClock(t *testing.T) {
	l := &providerLyrics{Lines: []providerLyricLine{{MS: 3500, Duration: 2000, Line: "Лови цей ритм"}, {MS: 6000, Duration: 2000, Line: "Інший рядок"}}, WordLines: json.RawMessage(originalWordLines)}
	cues := providerCues(l)
	if len(cues) != 2 || cues[0].StartMS != 3500 || cues[0].EndMS != 5500 || len(cues[0].Words) != 3 || len(cues[1].Words) != 0 || lyricSync(cues) != "mixed" {
		t.Fatal("partial native source moved or discarded untimed lines")
	}
	l.Lines[0].Duration = 1000
	if cues := providerCues(l); len(cues[0].Words) > 0 {
		t.Fatal("words were squeezed into a different line interval")
	}
}

func TestMalformedNativeWordsFallBackWithoutInventingBoundaries(t *testing.T) {
	for _, raw := range []string{`"bad optional shape"`, `[{"start":0,"end":5000,"words":[{"start":5,"end":3,"word":"Лови"}]}]`, `[{"start":0,"end":5000,"words":[{"start":500,"end":900,"word":"Лови"},{"start":700,"end":1200,"word":"цей"},{"start":1500,"end":1800,"word":"ритм"}]}]`, `[{"start":0,"end":5000,"words":[{"start":500,"end":900,"word":"Сторонній текст"}]}]`} {
		cues := providerCues(&providerLyrics{Lines: []providerLyricLine{{MS: 0, Duration: 5000, Line: "Лови цей ритм"}}, WordLines: json.RawMessage(raw)})
		if len(cues) != 1 || len(cues[0].Words) != 0 || cues[0].StartMS != 0 || lyricSync(cues) != "line" {
			t.Fatal("invalid native source replaced usable line timing")
		}
	}
}

func TestMissingNativeTimesDoNotBecomeZero(t *testing.T) {
	for _, raw := range []string{
		`[{"end":1000,"words":[{"start":0,"end":1000,"word":"Ритм"}]}]`,
		`[{"start":null,"end":1000,"words":[{"start":0,"end":1000,"word":"Ритм"}]}]`,
		`[{"start":0,"words":[{"start":0,"end":1000,"word":"Ритм"}]}]`,
		`[{"start":0,"end":1000,"words":[{"end":1000,"word":"Ритм"}]}]`,
		`[{"start":0,"end":1000,"words":[{"start":null,"end":1000,"word":"Ритм"}]}]`,
		`[{"start":0,"end":1000,"words":[{"start":0,"word":"Ритм"}]}]`,
	} {
		cues := providerCues(&providerLyrics{Lines: []providerLyricLine{{MS: 0, Duration: 1000, Line: "Ритм"}}, WordLines: json.RawMessage(raw)})
		if len(cues) != 1 || len(cues[0].Words) != 0 {
			t.Fatal("missing native time became a fabricated word boundary")
		}
	}
}

func TestProviderWordRequestAndGracefulOlderSchemaFallback(t *testing.T) {
	token := musicJWT()
	calls := 0
	a := &musicAdapter{http: &http.Client{Transport: musicTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Fatal("lost server-only auth")
		}
		var body struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(body.Query, "synchronizedWordByWordLines") {
			return musicResponse(200, `{"errors":[{"message":"Cannot query field synchronizedWordByWordLines"}]}`), nil
		}
		return musicResponse(200, `{"data":{"track":{"lyrics":{"synchronizedLines":[{"milliseconds":0,"duration":3000,"line":"Рядок лишається"}]}}}}`), nil
	})}}
	cues, status := a.lyrics(context.Background(), "123", token)
	if status != "ready" || len(cues) != 1 || len(cues[0].Words) != 0 || calls != 2 {
		t.Fatal("new optional field broke line-only provider compatibility")
	}
	a.http.Transport = musicTransport(func(r *http.Request) (*http.Response, error) {
		return musicResponse(200, `{"data":{"track":{"lyrics":{"synchronizedWordByWordLines":`+originalWordLines+`}}}}`), nil
	})
	cues, status = a.lyrics(context.Background(), "123", token)
	if status != "ready" || len(cues[0].Words) != 3 {
		t.Fatal("native provider payload did not reach the track")
	}
}
