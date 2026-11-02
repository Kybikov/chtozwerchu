# Network music studio 1.3

## Devices and authority

The prepared main app becomes a media station. It owns the local audio file or
public preview and reports the actual audio clock, readiness and volume. A host
phone receives private track/cue data and sends commands. Audience devices receive
only a server-generated scene projection; upcoming lyrics and the target answer
never travel to those clients before adjudication.

The Go state machine owns phase transitions, alternating turns, scores, history,
answer deadlines, undo and final standings. It rejects stale versions and remembers
the last 256 command IDs. Repeating a request cannot add another award. A station
cannot publish arbitrary scores through telemetry. The station cuts audio locally
at the target to avoid waiting for a network round trip; telemetry makes the server
enter the answer phase and start its deadline. Browsers never resume playback
automatically after connection loss or a server restart.

## Transport

- `POST /api/studio/rooms`: import a validated prepared match; returns separate
  random station and host capabilities, a six-character code and expiry.
- `GET /api/studio/ws`: authenticate in the first frame within eight seconds.
  Capabilities do not appear in query strings, HTTP logs or audience payloads.
- `DELETE /api/studio/rooms/{code}`: station capability required; ends the network
  session. The main browser retains its current match for local play.
- Private host links use `?screen=remote&room=CODE#token=...`. The app stores the
  token in that tab's sessionStorage and removes the fragment from the address bar.
- Audience links use `?screen=room&room=CODE` and confer no control permission.
- Only one station and one host connection remain active. A replacement explicitly
  ends the old connection, which stops reconnecting instead of fighting for control.
- Same-origin checks, role validation, payload limits, per-connection message limits,
  a 200-room cap and a 64-connection cap bound the in-process service.
- Semantic changes send full private snapshots; audio clocks send compact updates.
  The station sends telemetry at 5 Hz. A one-second application heartbeat and
  five-second browser watchdog pause local playback if messages stop arriving;
  WebSocket ping/pong provides the transport-level connection check.

## Recovery and storage

`STUDIO_STATE_DIR` enables atomic private snapshots. Files store capability hashes,
match data and timers; they contain no Deezer ARL/JWT or audio bytes. Directories
use 0700 and files 0600 where supported by the host. A successful score mutation is
saved before acknowledgement. A failed save rolls that action back and pauses the
game. Station or host disconnection pauses music and the answer deadline. Audio
readiness must be confirmed again after reconnecting the media station.

`npm start` defaults to ignored `output/studio-state`. The Docker image prepares
`/app/state/studio`, and Compose mounts the named `studio_state` volume. Deployments
outside Compose must preserve that directory separately. Rooms expire after twelve
hours; they are event sessions, not the permanent account history planned next.
Each replica currently owns its rooms: route a room to one instance. A multi-node
room registry/lock is not implemented.

## Verification

- 17 frontend tests cover local game rules, LRC parsing and private scene projection.
- Go tests cover four-turn matches, idempotent awards, undo, deadline pause/resume,
  reachable audio targets, public redaction, durable recovery, WebSocket role checks,
  stale commands, zero-volume serialization and station-disconnect pauses.
- `go test ./...`, `go vet ./...`, TypeScript and the production build pass.
- The Windows environment lacks the C compiler required by Go's race detector;
  `-race` was not available. No claim of a successful race-detector run is made.
- Browser checks used three independent WebSocket clients: media station, host and
  audience. A complete four-turn match, final, new game, live track search/change,
  host replacement, local-mode return and a real test-server restart were verified.
- Synthetic test audio stopped at 10.546 s for a 10.500 s target. This measures one
  run and does not establish a universal latency guarantee.
- At 390 px, the active answer view keeps timer, answer and award buttons together.

## Current limits

The private preview is loopback-bound and SSH-forwarded; a phone needs a reachable
site origin to use it physically. The UI states this when opened on localhost.
Local files must be prepared on the media station. Uploading a file from the phone,
account ownership, other competitions and supported full-provider streaming remain
separate work. Network commands intentionally stop when the server is unavailable;
the ordinary local game remains available independently.

The private preview smoke check also created a real-track room on the VPS, opened
the host controller, exercised preview play/pause and returned to local mode.
Both browser console logs were empty. The final loaded script was
`/assets/index-1DIoR8oS.js`. Test rooms were closed after verification.
