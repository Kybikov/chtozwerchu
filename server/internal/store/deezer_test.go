package store

import "testing"

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
