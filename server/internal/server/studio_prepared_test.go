package server

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestStudioPreparedLibraryRolesAndLoading(t *testing.T) {
	_, srv, access := newStudioTestServer(t)
	station := studioDial(t, srv.URL, access.Code, "station", access.StationToken)
	studioRead(t, station, "state")
	host := studioDial(t, srv.URL, access.Code, "host", access.HostToken)
	studioRead(t, host, "state")
	viewer := studioDial(t, srv.URL, access.Code, "audience", "")
	studioRead(t, viewer, "scene")
	library := []studioPrepared{{ID: 2, Title: "Prepared hidden fixture", Artist: "Original", Duration: 32, Local: true}}
	_ = host.WriteJSON(studioEnvelope{Type: "library", Library: library})
	studioRead(t, host, "error")
	_ = station.WriteJSON(studioEnvelope{Type: "library", Library: library})
	state := clusterStudioState(t, host, func(s studioState) bool { return len(s.Library) == 1 })
	if state.Library[0].ID != 2 {
		t.Fatal("host did not receive the prepared catalogue")
	}
	scene := studioRead(t, viewer, "scene")
	if bytes.Contains(scene["state"], []byte("Prepared hidden")) {
		t.Fatal("future prepared song leaked to audience")
	}
	_ = viewer.WriteJSON(studioEnvelope{Type: "library", Library: library})
	studioRead(t, viewer, "error")
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "load_prepared", TrackID: 9, Version: state.Version, ID: "missing-prepared-fixture"}})
	studioRead(t, host, "error")
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "load_prepared", TrackID: 2, Version: state.Version, ID: "load-prepared-fixture"}})
	m := studioRead(t, station, "instruction")
	var instruction studioInstruction
	_ = json.Unmarshal(m["instruction"], &instruction)
	if instruction.Type != "load_track" || instruction.TrackID != 2 || !instruction.Prepared {
		t.Fatal("station did not receive an explicit prepared-source instruction")
	}
	loaded := clusterStudioState(t, host, func(s studioState) bool { return s.Version > state.Version })
	if loaded.Audio.Ready || loaded.Session.Aligned {
		t.Fatal("old media was left ready during a prepared song change")
	}
}

func TestStudioRejectsInvalidPreparedCatalogue(t *testing.T) {
	good := studioPrepared{ID: 1, Title: "Fixture", Duration: 12}
	if !validStudioLibrary([]studioPrepared{good}) {
		t.Fatal("valid library rejected")
	}
	bad := good
	bad.Cover = "javascript:alert(1)"
	for _, library := range [][]studioPrepared{{good, good}, {bad}, make([]studioPrepared, 41)} {
		if validStudioLibrary(library) {
			t.Fatal("invalid library accepted")
		}
	}
}

func TestStudioMissingStationDoesNotDiscardCalibration(t *testing.T) {
	_, srv, access := newStudioTestServer(t)
	host := studioDial(t, srv.URL, access.Code, "host", access.HostToken)
	initial := studioRead(t, host, "state")
	var before studioState
	_ = json.Unmarshal(initial["state"], &before)
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "load_track", TrackID: 2, Version: before.Version, ID: "missing-station-fixture"}})
	studioRead(t, host, "error")
	latest := studioRead(t, host, "state")
	var after studioState
	_ = json.Unmarshal(latest["state"], &after)
	if after.Session.Aligned != before.Session.Aligned || after.Version != before.Version || after.Track.ID != before.Track.ID {
		t.Fatal("undeliverable instruction changed the preparation")
	}
}
