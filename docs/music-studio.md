# Music Studio 1.15

## Direction

A music-show stage with oversized Oswald display type, Onest interface text,
rose and periwinkle teams, iridescent record artwork and restrained React Bits
lighting. Typography and controls share one scale across the stage, host panel,
library, calibration and dialogs. Operational text is larger than the first
prototype; narrow screens reflow rather than shrinking the desktop dashboard.

All buttons use the adapted React Bits SpecularButton. The TV link uses its CSS
surface with native anchor semantics. WakeSlider, SquishSwitch, SpotlightCard,
BlurText and CountUp supply the other visible controls and animated surfaces.
Radix supplies dialog focus, dismissal and keyboard behaviour. Native audio,
select, range and file controls are hidden; importing opens the OS file picker.

## Live-fetched React Bits sources, 2 November 2026

Free registry (`https://reactbits.dev/r/<Name>-TS-CSS.json`):

- SpecularButton: all buttons. Added an `effects` prop so secondary controls do
  not create WebGL contexts. The studio uses its CSS surface and interaction.
- WakeSlider: transport seeking and volume; controlled values, keyboard support.
- SquishSwitch: atmospheric effects toggle.
- SpotlightCard: stage, host panel, library cards.
- BlurText: opening headline.
- CountUp: scores.

Licensed Pro registry: `@reactbits-starter/grain-wave-css`. The license key was
used only during the fetch, never written to source. GrainWave is lazy-loaded;
DPR is limited to 1, the longest backing dimension to 1200 pixels, and animation
to 30 fps. The original shader uses a small native WebGL renderer instead of
the Three.js scene graph; antialiasing is disabled, and an explicit theme replaces
the SSR theme script. Hidden tabs and reduced-motion preferences disable the
animated backdrop. GPU failure leaves the CSS ambient backdrop intact.

The components are adapted source, not recreated from memory. Preserve their
upstream licensing. No registry credentials belong in components.json or Git.

## Backend boundary

Read-only routes: `GET /api/music/status`, `/search?q=...`, `/track?id=...`.
The adapter accepts server environment credentials, renews ARL-based JWT under
a mutex, limits provider response sizes, validates numeric IDs, caches up to
64 successful track reads for 10 minutes, and returns safe status codes instead
of provider response bodies. Credential rejection is retried once when ARL is
available. No playlist mutations, protected-media decryption or audio storage.

The prototype preview may run separately from production via an SSH tunnel to
a loopback-bound process. It does not change WTAdmin source or its deployment.
The app itself has no dependency on WTAdmin's database or stored secret format.

## Local match

- 4, 8, 12 or 16 alternating team turns; 15, 20, 30 or 45 seconds per answer.
- A round records its track, answer, playing team and award, including no award.
- Awards are idempotent; double-clicks cannot award twice or advance the phase.
- The host may undo the current award. Prior history remains unchanged.
- Only new answer lines inside the actual audio fragment are picked automatically.
  Exhausted fragments open the library rather than silently repeating the last line.
- Scores, names, settings, round history and final state survive reloads. Unfinished
  rounds return to preparation; playback never starts automatically after reload.
- Final standings correctly handle wins and ties. A new game clears history and
  returns to preparation, while preserving team names, music and match settings.
- Audio timelines use audio.currentTime; answer clocks use elapsed monotonic time.
  Hiding the host pauses audio and the answer clock. Time expiry leaves adjudication
  to the host instead of awarding or skipping automatically.
- Native Deezer word data and Enhanced LRC preserve exact word timestamps and gaps.
  Invalid optional word data falls back to valid lines. Partial native data never
  manufactures missing word intervals. Coverage is visible to the host.
- A changed provider line timeline invalidates the previous live calibration.
  Saved preparations retain their own immutable cue snapshot. A provider refresh
  does not silently retime a saved song.
- The preparation dialog has its own React Bits seek controls and bounded
  per-line audition. Bounds use the calibrated audio clock; unavailable lines
  cannot be auditioned. Closing or changing calibration stops the audition.
  Playback checks do not start a round or award points. Host operation text is
  14–18 px, with a two-column desktop workspace and stacked phone layout.

## Separate audience window

The host link opens /?screen=show&room=<ephemeral-id>. Move the tab or window to
an extended display and make it fullscreen. The host remains on the laptop.
BroadcastChannel synchronizes public scene data in the same browser and origin;
the room id survives host reloads. The scene receives no target answer before the
result and never renders the host panel. Audio still plays from the host device,
which can output to the TV via HDMI. Keep the host window visible while playing.
A stale host connection shows a reconnect notice. This local multi-display mode
is separate from the network phone mode described below.

## Assets

public/show-vinyl.webp is an original generated stage asset (about 206 kB), included
in PWA precaching. Generation mode and the final prompt are in asset-provenance.md.
The font files are local; the show does not fetch fonts from a third-party CDN.

## Follow-up scope

Account-owned network shows and private result history are implemented; see
[accounts](release-1.4.md) and [profile](release-1.19.md). Current room recovery
uses [Redis coordination](release-1.9.md). [Audio-clock cutoffs](release-1.20.md)
apply to both local play and the network media station.

- Add a supported full-track playback path; see music-playback.md for the current
  provider capabilities. Round clip duration and private audition ship in 1.15.
- Additional event packs, room browsing and broader show sound cues remain extensions.

## Network studio 1.3

See studio-network.md for the protocol, persistence and operational limits. The
existing same-browser BroadcastChannel audience remains available for local play.
The new phone mode uses a server-authoritative WebSocket room and three roles.
