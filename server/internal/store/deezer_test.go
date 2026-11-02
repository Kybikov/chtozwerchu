package store

import "testing"

func TestPreviewMatchesTitleAndArtistBeforeUsingAudio(t *testing.T) {
	body := []byte(`{"data":[{"title":"Місто весни (Remix)","artist":{"name":"Okean Elzy"},"preview":"remix"},{"title":"Місто весни","artist":{"name":"Clavier"},"preview":"cover"},{"title":"Місто весни","artist":{"name":"Okean Elzy"},"preview":"correct"}]}`)
	if got := matchingDeezerPreview(body, "Місто весни", "Океан Ельзи & Один в каное"); got != "correct" {
		t.Fatalf("selected %q", got)
	}
	if got := matchingDeezerPreview(body, "Another title", "Океан Ельзи"); got != "" {
		t.Fatal("used unrelated audio")
	}
}

func TestParseDeezerPreview(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"hit", `{"data":[{"preview":"https://cdn.deezer.com/x.mp3"}]}`, "https://cdn.deezer.com/x.mp3"},
		{"skip empty", `{"data":[{"preview":""},{"preview":"https://a.mp3"}]}`, "https://a.mp3"},
		{"no data", `{"data":[]}`, ""},
		{"garbage", `not json`, ""},
	}
	for _, tc := range cases {
		if got := parseDeezerPreview([]byte(tc.body)); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
