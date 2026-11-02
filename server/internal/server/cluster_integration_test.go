package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"chtozverchu/internal/config"
	"chtozverchu/internal/game"
	"chtozverchu/internal/store"
	"github.com/gorilla/websocket"
)

func TestRedisOwnershipFencingAndConcurrentRestoreIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	old, err := a.app.cluster.reserve("party", "ZZZ22")
	if err != nil {
		t.Fatal(err)
	}
	if err = a.app.cluster.commit(old, []byte(`{"current":true}`), time.Hour); err != nil {
		t.Fatal(err)
	}
	newEpoch := b.app.cluster.id + "." + studioSecret()
	if err = b.cache.RedisClient().Set(ctx, b.app.cluster.ownerKey(old), newEpoch, 6*time.Second).Err(); err != nil {
		t.Fatal(err)
	}
	if err = a.app.cluster.commit(old, []byte(`{"stale":true}`), time.Hour); err != errRoomOwner {
		t.Fatal("Redis accepted a write from a fenced owner")
	}
	if err = a.app.cluster.publish(b.app.cluster.id, relayPacket{Op: "reply", ID: "stale-fixture", Binding: old}, true); err == nil {
		t.Fatal("Redis published a stale owner's response")
	}
	a.app.cluster.release(old)
	if epoch, _ := b.cache.RedisClient().Get(ctx, b.app.cluster.ownerKey(old)).Result(); epoch != newEpoch {
		t.Fatal("stale cleanup deleted a new owner's lease")
	}
	room, _ := a.app.hub.engine.CreateRoom(game.CreateParams{HostName: "Concurrent fixture", Rounds: 1, RoundTypes: []game.RoundType{game.RoundMelody}})
	raw, _ := game.Snapshot(room)
	if err = a.app.cluster.importSnapshot("party", room.Code, raw, time.Hour); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	type outcome struct {
		binding roomBinding
		err     error
	}
	results := make(chan outcome, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := a.app.cluster
			if i%2 == 1 {
				c = b.app.cluster
			}
			binding, err := c.resolve("party", room.Code)
			results <- outcome{binding, err}
		}(i)
	}
	wg.Wait()
	close(results)
	var epoch string
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if epoch == "" {
			epoch = result.binding.Epoch
		}
		if epoch != result.binding.Epoch {
			t.Fatal("concurrent joins elected two owners")
		}
	}
	count := 0
	for _, node := range []*clusterTestNode{a, b} {
		if node.app.hub.session(room.Code) != nil {
			count++
		}
	}
	if count != 1 {
		t.Fatal("private snapshot restored on multiple owners")
	}
}

func TestRedisUnreleasedLeaseExpiresAndRoomRecoversIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	host := clusterDial(t, a, "/ws")
	clusterSend(t, host, "create_room", map[string]any{"protocol": 3, "hostName": "Crash fixture", "rounds": 1})
	identity := clusterRead(t, host, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var code, token string
	_ = json.Unmarshal(identity["code"], &code)
	_ = json.Unmarshal(identity["token"], &token)
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	viewer := clusterDial(t, b, "/ws")
	clusterSend(t, viewer, "watch", map[string]any{"protocol": 3, "code": code})
	_ = clusterState(t, viewer, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	// Stop I/O and heartbeats without releasing ownership, as in a process crash.
	c := a.app.cluster
	c.cancel()
	c.sub.Close()
	c.rdb.Close()
	deadline := time.Now().Add(9 * time.Second)
	for b.cache.RedisClient().Exists(context.Background(), c.ownerKey(roomBinding{Kind: "party", Code: code})).Val() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("crashed owner's lease did not expire")
		}
		time.Sleep(50 * time.Millisecond)
	}
	reconnected := clusterDial(t, b, "/ws")
	clusterSend(t, reconnected, "join", map[string]any{"protocol": 3, "code": code, "token": token})
	restored := clusterState(t, reconnected, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	if restored.You == nil || !restored.You.IsHost {
		t.Fatal("crash recovery lost host access")
	}
}

func TestRedisSubscriptionLossClosesAndRejoinsRoomIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	host := clusterDial(t, a, "/ws")
	clusterSend(t, host, "create_room", map[string]any{"protocol": 3, "hostName": "Reconnect fixture", "rounds": 1})
	identity := clusterRead(t, host, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var code, token string
	_ = json.Unmarshal(identity["code"], &code)
	_ = json.Unmarshal(identity["token"], &token)
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	list, err := b.cache.RedisClient().ClientList(ctx).Result()
	if err != nil {
		t.Fatal(err)
	}
	killed := false
	for _, line := range strings.Split(list, "\n") {
		fields := map[string]string{}
		for _, field := range strings.Fields(line) {
			kv := strings.SplitN(field, "=", 2)
			if len(kv) == 2 {
				fields[kv[0]] = kv[1]
			}
		}
		if fields["name"] == "khz-room-"+a.app.cluster.id && strings.Contains(fields["flags"], "P") {
			if err = b.cache.RedisClient().ClientKillByFilter(ctx, "ID", fields["id"]).Err(); err != nil {
				t.Fatal(err)
			}
			killed = true
		}
	}
	if !killed {
		t.Fatal("isolated test subscriber not found")
	}
	_ = host.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err = host.ReadMessage(); err != nil {
			break
		}
	}
	if websocket.IsUnexpectedCloseError(err, websocket.CloseAbnormalClosure) == false && strings.Contains(err.Error(), "timeout") {
		t.Fatal("lost subscriber left a live room socket")
	}
	deadline := time.Now().Add(9 * time.Second)
	for b.cache.RedisClient().Exists(context.Background(), a.app.cluster.ownerKey(roomBinding{Kind: "party", Code: code})).Val() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("lost subscription kept ownership")
		}
		time.Sleep(50 * time.Millisecond)
	}
	reconnected := clusterDial(t, b, "/ws")
	clusterSend(t, reconnected, "join", map[string]any{"protocol": 3, "code": code, "token": token})
	_ = clusterState(t, reconnected, func(v game.RoomView) bool { return v.You != nil && v.You.IsHost })
}

func TestRedisIngressCrashPausesHostRoomIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	host := clusterDial(t, a, "/ws")
	clusterSend(t, host, "create_room", map[string]any{"protocol": 3, "hostName": "Ingress fixture", "rounds": 1, "roundTypes": []string{"alias"}})
	identity := clusterRead(t, host, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var code, token string
	_ = json.Unmarshal(identity["code"], &code)
	_ = json.Unmarshal(identity["token"], &token)
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	remoteHost := clusterDial(t, b, "/ws")
	clusterSend(t, remoteHost, "join", map[string]any{"protocol": 3, "code": code, "token": token})
	_ = clusterState(t, remoteHost, func(v game.RoomView) bool { return v.You != nil && v.You.IsHost })
	viewer := clusterDial(t, a, "/ws")
	clusterSend(t, viewer, "watch", map[string]any{"protocol": 3, "code": code})
	_ = clusterState(t, viewer, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	clusterSend(t, remoteHost, "start_game", nil)
	_ = clusterState(t, remoteHost, func(v game.RoomView) bool { return v.Stage == game.StagePlaying })
	clusterSend(t, remoteHost, "action", map[string]any{"name": "resume"})
	_ = clusterState(t, viewer, func(v game.RoomView) bool { return !v.Paused })
	b.app.cluster.cancel()
	b.app.cluster.sub.Close()
	b.app.cluster.rdb.Close()
	// The owner still runs; expired ingress presence must close its virtual host.
	_ = viewer.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		var msg mediaWire
		if err := viewer.ReadJSON(&msg); err != nil {
			t.Fatal("lost ingress left the host clock running", err)
		}
		if msg.Type == "state" && msg.Paused {
			break
		}
	}
	if a.app.hub.session(code) == nil {
		t.Fatal("ingress loss discarded the healthy owner's room")
	}
}

func TestRedisBootstrapDoesNotResurrectAnOldPrivateFileIntegration(t *testing.T) {
	a, _ := clusterTestNodes(t)
	host := clusterDial(t, a, "/ws")
	clusterSend(t, host, "create_room", map[string]any{"protocol": 3, "hostName": "Bootstrap fixture", "rounds": 1})
	identity := clusterRead(t, host, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var code string
	_ = json.Unmarshal(identity["code"], &code)
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	s := a.app.hub.session(code)
	a.app.hub.persist(s)
	a.app.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := a.cache.RedisClient().Del(ctx, a.app.cluster.stateKey(s.binding)).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(a.partyDir, code+".json")); err != nil {
		t.Fatal("fixture private backup missing")
	}
	t.Setenv("PARTY_STATE_DIR", a.partyDir)
	t.Setenv("STUDIO_STATE_DIR", a.studioDir)
	hub := NewHub(game.NewEngine(mediaCatalog{}), a.cache, nil, "bootstrap-fixture-only")
	app := New(a.app.cfg, hub, a.app.catalog, nil)
	app.Handler()
	defer app.Close()
	if app.cluster == nil {
		t.Fatal("coordinator did not restart")
	}
	if _, err := app.cluster.resolve("party", code); err != errRoomMissing {
		t.Fatal("an old file resurrected deleted canonical state")
	}
}

func TestRedisGatewayRejectsCrossOriginIntegration(t *testing.T) {
	a, _ := clusterTestNodes(t)
	for _, path := range []string{"/ws", "/api/studio/ws"} {
		conn, res, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(a.http.URL, "http")+path, http.Header{"Origin": []string{"https://unrelated.example"}})
		if conn != nil {
			conn.Close()
		}
		if err == nil || res == nil || res.StatusCode != 403 {
			t.Fatal("cluster gateway accepted a cross-origin socket")
		}
	}
}

type clusterTestNode struct {
	app                 *Server
	http                *httptest.Server
	cache               *store.Cache
	partyDir, studioDir string
}

type clusterCatalog struct{ mediaCatalog }

func (clusterCatalog) AliasCards(string) []game.AliasCard {
	return []game.AliasCard{{ID: "cluster-alias-fixture", Word: "Fixture word"}}
}

func clusterStudioState(t *testing.T, c *websocket.Conn, predicate func(studioState) bool) studioState {
	t.Helper()
	var state studioState
	clusterRead(t, c, func(m map[string]json.RawMessage) bool {
		if clusterKind(m) != "state" {
			return false
		}
		_ = json.Unmarshal(m["state"], &state)
		return predicate(state)
	})
	return state
}

func TestRedisStudioWordsAndOwnerFailoverIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	s := studioFixture()
	s.Track.Cues[0].Text = "Лови цей ритм"
	s.Track.Cues[0].Words = []musicWord{{StartMS: 53, EndMS: 350, Text: "Лови "}, {StartMS: 700, EndMS: 1020, Text: "цей "}, {StartMS: 1100, EndMS: 1350, Text: "ритм"}}
	body, _ := json.Marshal(map[string]any{"session": s.Session, "track": s.Track, "audio": s.Audio})
	res, err := http.Post(a.http.URL+"/api/studio/rooms", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	var access studioTestAccess
	if res.StatusCode != 201 || json.NewDecoder(res.Body).Decode(&access) != nil {
		t.Fatal("cluster studio create failed")
	}
	res.Body.Close()
	bad := studioDial(t, b.http.URL, access.Code, "host", "invalid-fixture-token")
	studioRead(t, bad, "fatal")
	station := studioDial(t, a.http.URL, access.Code, "station", access.StationToken)
	_ = clusterStudioState(t, station, func(s studioState) bool { return s.Phase == "ready" })
	host := studioDial(t, b.http.URL, access.Code, "host", access.HostToken)
	state := clusterStudioState(t, host, func(s studioState) bool { return s.Phase == "ready" })
	audience := studioDial(t, b.http.URL, access.Code, "audience", "")
	scene := studioRead(t, audience, "scene")
	if bytes.Contains(scene["state"], []byte("Hidden answer")) || bytes.Contains(scene["state"], []byte("Synthetic")) {
		t.Fatal("private track leaked to another node's audience")
	}
	_ = audience.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "new_game", ID: "remote-viewer-forgery", Version: state.Version}})
	studioRead(t, audience, "error")
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Duration: 12, Volume: 65}})
	studioRead(t, station, "clock")
	_ = host.WriteJSON(studioEnvelope{Type: "action", Action: studioAction{Type: "start", ID: "remote-start-command", Version: state.Version}})
	state = clusterStudioState(t, host, func(s studioState) bool { return s.Phase == "playing" })
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Playing: true, Duration: 12, Position: .75, Volume: 65}})
	var public struct {
		NowMS float64     `json:"nowMS"`
		Words []musicWord `json:"words"`
	}
	clusterRead(t, audience, func(m map[string]json.RawMessage) bool {
		if clusterKind(m) != "scene" {
			return false
		}
		_ = json.Unmarshal(m["state"], &public)
		return public.NowMS == 750
	})
	if len(public.Words) != 3 || public.Words[0].EndMS != 350 || public.Words[1].StartMS != 700 {
		t.Fatal("relay changed captured word boundaries or gaps")
	}
	_ = station.WriteJSON(studioEnvelope{Type: "telemetry", Audio: studioAudio{Ready: true, Duration: 12, Position: 3.01, Volume: 65}})
	state = clusterStudioState(t, host, func(s studioState) bool { return s.Phase == "answer" })
	matchID := state.Session.MatchID
	ownerRoom := a.app.studio.get(access.Code)
	if ownerRoom == nil || b.app.studio.get(access.Code) != nil {
		t.Fatal("studio has multiple owners")
	}
	// Save a running clock with a measurable remaining interval; restore must
	// freeze that saved interval rather than restart the full twenty seconds.
	ownerRoom.mu.Lock()
	ownerRoom.State.Timer.Deadline = time.Now().Add(8500 * time.Millisecond).UnixMilli()
	ownerRoom.State.Timer.Paused = false
	if err := a.app.studio.save(ownerRoom); err != nil {
		ownerRoom.mu.Unlock()
		t.Fatal(err)
	}
	ownerRoom.mu.Unlock()
	a.app.cluster.close()
	reconnected := studioDial(t, b.http.URL, access.Code, "host", access.HostToken)
	restored := clusterStudioState(t, reconnected, func(s studioState) bool { return s.Phase == "answer" })
	if restored.Session.MatchID != matchID || !restored.Timer.Paused || restored.Timer.Deadline != 0 || restored.Timer.LeftMS < 7000 || restored.Timer.LeftMS > 8500 || restored.Audio.Ready || restored.Audio.Playing {
		t.Fatal("studio failover lost match or remaining paused clock")
	}
	if b.app.studio.get(access.Code) == nil {
		t.Fatal("second node did not restore from shared Redis")
	}
	team := "girls"
	award := studioEnvelope{Type: "action", Action: studioAction{Type: "award", ID: "remote-award-command", Version: restored.Version, Team: &team}}
	_ = reconnected.WriteJSON(award)
	result := clusterStudioState(t, reconnected, func(s studioState) bool { return s.Phase == "result" })
	_ = reconnected.WriteJSON(award)
	retried := clusterStudioState(t, reconnected, func(s studioState) bool { return s.Phase == "result" })
	if result.Session.Scores[team] != 3 || retried.Session.Scores[team] != 3 || len(retried.Session.History) != 1 {
		t.Fatal("retried remote award duplicated points")
	}
	// HTTP request enters a third node with another independent disk, while B owns the room.
	c := clusterNewTestNode(t)
	req, _ := http.NewRequest(http.MethodDelete, c.http.URL+"/api/studio/rooms/"+access.Code, nil)
	req.Header.Set("Authorization", "Bearer "+access.HostToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("host token could terminate the station's connection")
	}
	req.Header.Set("Authorization", "Bearer "+access.StationToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("cross-node room closure failed: %d", resp.StatusCode)
	}
	_ = clusterRead(t, reconnected, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "closed" })
}

func clusterTestNodes(t *testing.T) (*clusterTestNode, *clusterTestNode) {
	t.Helper()
	endpoint := os.Getenv("KHZ_TEST_REDIS_URL")
	if endpoint == "" {
		t.Skip("KHZ_TEST_REDIS_URL is not set")
	}
	prefix := "khz:test:" + studioSecret()
	t.Setenv("ROOM_CLUSTER_NAMESPACE", prefix)
	var a, b *clusterTestNode
	t.Cleanup(func() {
		if a == nil {
			return
		}
		// Nodes and sockets have already stopped. Delete only this namespace.
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cache, err := store.ConnectRedis(ctx, endpoint)
		if err != nil {
			return
		}
		defer cache.Close()
		var cursor uint64
		for {
			keys, next, err := cache.RedisClient().Scan(ctx, cursor, prefix+":*", 100).Result()
			if err != nil {
				return
			}
			if len(keys) > 0 {
				_ = cache.RedisClient().Del(ctx, keys...).Err()
			}
			cursor = next
			if cursor == 0 {
				return
			}
		}
	})
	a, b = clusterNewTestNode(t), clusterNewTestNode(t)
	return a, b
}

func clusterNewTestNode(t *testing.T) *clusterTestNode {
	t.Helper()
	endpoint := os.Getenv("KHZ_TEST_REDIS_URL")
	dir := t.TempDir()
	partyDir, studioDir := filepath.Join(dir, "party"), filepath.Join(dir, "studio")
	t.Setenv("PARTY_STATE_DIR", partyDir)
	t.Setenv("STUDIO_STATE_DIR", studioDir)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cache, err := store.ConnectRedis(ctx, endpoint)
	if err != nil {
		t.Fatal("isolated Redis unavailable")
	}
	catalog, err := store.EmbeddedCatalog()
	if err != nil {
		t.Fatal(err)
	}
	hub := NewHub(game.NewEngine(clusterCatalog{}), cache, nil, "cluster-fixture-only")
	app := New(config.Config{RedisURL: endpoint, JWTSecret: "cluster-fixture-only"}, hub, catalog, nil)
	http := httptest.NewServer(app.Handler())
	if app.cluster == nil || !app.cluster.ready.Load() {
		t.Fatal("Redis room transport not ready")
	}
	node := &clusterTestNode{app, http, cache, partyDir, studioDir}
	t.Cleanup(func() { app.Close(); http.Close(); cache.Close() })
	return node
}

func clusterDial(t *testing.T, node *clusterTestNode, path string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(node.http.URL, "http")+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}
func clusterSend(t *testing.T, conn *websocket.Conn, kind string, payload any) {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{"type": kind, "payload": payload}); err != nil {
		t.Fatal(err)
	}
}
func clusterRead(t *testing.T, conn *websocket.Conn, predicate func(map[string]json.RawMessage) bool) map[string]json.RawMessage {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var msg map[string]json.RawMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatal("cluster response missing", err)
		}
		if predicate(msg) {
			return msg
		}
		if clusterKind(msg) == "error" || clusterKind(msg) == "fatal" {
			t.Fatalf("protocol rejected test action: %s", msg["message"])
		}
	}
}
func clusterKind(msg map[string]json.RawMessage) string {
	var kind string
	_ = json.Unmarshal(msg["type"], &kind)
	return kind
}
func clusterState(t *testing.T, conn *websocket.Conn, predicate func(game.RoomView) bool) game.RoomView {
	t.Helper()
	var state game.RoomView
	clusterRead(t, conn, func(msg map[string]json.RawMessage) bool {
		if clusterKind(msg) != "state" {
			return false
		}
		body, _ := json.Marshal(msg)
		_ = json.Unmarshal(body, &state)
		return predicate(state)
	})
	return state
}

func TestRedisPartyAcrossNodesAndOwnerFailoverIntegration(t *testing.T) {
	a, b := clusterTestNodes(t)
	host := clusterDial(t, a, "/ws")
	clusterSend(t, host, "create_room", map[string]any{"protocol": 3, "hostName": "Cluster host", "rounds": 1, "roundTypes": []string{"melody"}, "melodyMode": "buzzer"})
	identity := clusterRead(t, host, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var code, hostToken, tvToken string
	_ = json.Unmarshal(identity["code"], &code)
	_ = json.Unmarshal(identity["token"], &hostToken)
	_ = json.Unmarshal(identity["tvToken"], &tvToken)
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	boy := clusterDial(t, b, "/ws")
	clusterSend(t, boy, "join", map[string]any{"protocol": 3, "code": code, "name": "Remote player", "team": "boys"})
	boyIdentity := clusterRead(t, boy, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	var boyToken string
	_ = json.Unmarshal(boyIdentity["token"], &boyToken)
	_ = clusterState(t, boy, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	viewer := clusterDial(t, b, "/ws")
	clusterSend(t, viewer, "watch", map[string]any{"protocol": 3, "code": code})
	_ = clusterState(t, viewer, func(v game.RoomView) bool { return v.Stage == game.StageLobby })
	tv := clusterDial(t, b, "/ws")
	clusterSend(t, tv, "watch", map[string]any{"protocol": 3, "code": code, "tv": true, "tvToken": tvToken})
	_ = clusterState(t, tv, func(v game.RoomView) bool { return v.Media.TVConnected })
	clusterSend(t, host, "action", map[string]any{"name": "audio_output", "payload": map[string]any{"output": "tv"}})
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Media.Output == "tv" })
	clusterSend(t, host, "start_game", nil)
	playing := clusterState(t, tv, func(v game.RoomView) bool { return v.Stage == game.StagePlaying })
	clusterSend(t, tv, "media_status", mediaStatus{Enabled: true, Ready: true, Revision: playing.Media.Revision, Round: 1, Duration: 30})
	_ = clusterState(t, host, func(v game.RoomView) bool { return v.Media.Ready })
	clusterSend(t, host, "action", map[string]any{"name": "resume"})
	pending := clusterState(t, tv, func(v game.RoomView) bool { return v.Media.Pending })
	if !pending.Paused {
		t.Fatal("timer ran before remote TV playback acknowledgement")
	}
	clusterSend(t, tv, "media_status", mediaStatus{Enabled: true, Ready: true, Playing: true, Position: 4, Revision: pending.Media.Revision, Round: 1, Duration: 30})
	_ = clusterState(t, boy, func(v game.RoomView) bool { return v.Stage == game.StagePlaying && !v.Paused })
	clusterSend(t, boy, "action", map[string]any{"name": "buzz", "payload": map[string]any{"team": "girls"}})
	answer := clusterState(t, viewer, func(v game.RoomView) bool {
		round, _ := v.Round.(map[string]any)
		buzz, _ := round["buzzer"].(map[string]any)
		return buzz["phase"] == "answer"
	})
	if answer.ActiveTeam != game.TeamGirls {
		t.Fatal("fixture turn changed")
	}
	raw, _ := json.Marshal(answer)
	if strings.Contains(string(raw), "hostAnswer") || strings.Contains(string(raw), "Synthetic") {
		t.Fatal("private song reached remote viewer")
	}
	ownerRoom := a.app.hub.session(code)
	if ownerRoom == nil || b.app.hub.session(code) != nil {
		t.Fatal("room has multiple authoritative instances")
	}
	ownerRoom.mu.Lock()
	oldBinding := ownerRoom.binding
	matchID := ownerRoom.room.MatchID
	ownerRoom.mu.Unlock()
	a.app.cluster.close()
	_ = boy.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := boy.ReadMessage(); err == nil { // queued state may precede close
		_ = boy.SetReadDeadline(time.Now().Add(4 * time.Second))
		for {
			if _, _, err = boy.ReadMessage(); err != nil {
				break
			}
		}
	}
	reconnected := clusterDial(t, b, "/ws")
	clusterSend(t, reconnected, "join", map[string]any{"protocol": 3, "code": code, "token": hostToken})
	_ = clusterRead(t, reconnected, func(m map[string]json.RawMessage) bool { return clusterKind(m) == "you_are" })
	restored := clusterState(t, reconnected, func(v game.RoomView) bool { return v.Stage == game.StagePlaying })
	if !restored.Paused {
		t.Fatal("failover resumed clocks automatically")
	}
	round, _ := restored.Round.(map[string]any)
	buzz, _ := round["buzzer"].(map[string]any)
	if buzz["phase"] != "answer" || buzz["team"] != "boys" {
		t.Fatal("failover lost the first claimant")
	}
	newRoom := b.app.hub.session(code)
	newRoom.mu.Lock()
	newMatch := newRoom.room.MatchID
	newBinding := newRoom.binding
	newRoom.mu.Unlock()
	if newMatch != matchID || newBinding.Epoch == oldBinding.Epoch {
		t.Fatal("match identity or ownership fence was not preserved")
	}
	if err := b.app.cluster.commit(oldBinding, []byte(`{"stale":true}`), time.Hour); err == nil {
		t.Fatal("old owner could overwrite restored state")
	}
	clusterSend(t, reconnected, "action", map[string]any{"name": "resume"})
	_ = clusterState(t, reconnected, func(v game.RoomView) bool { return !v.Paused })
	clusterSend(t, reconnected, "action", map[string]any{"name": "force", "payload": map[string]any{"won": true}})
	result := clusterState(t, reconnected, func(v game.RoomView) bool { return v.Stage == game.StageResult })
	if result.Teams[game.TeamBoys].Score != 3 || result.Teams[game.TeamGirls].Score != 0 {
		t.Fatal("failover changed winner or points")
	}
	clusterSend(t, reconnected, "action", map[string]any{"name": "next"})
	final := clusterState(t, reconnected, func(v game.RoomView) bool { return v.Stage == game.StageFinal })
	if len(final.History) != 1 || final.History[0].Result.Team != game.TeamBoys {
		t.Fatal("final history lost the remote winner")
	}
	_ = boyToken
}
