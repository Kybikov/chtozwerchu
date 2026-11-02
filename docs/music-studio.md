# Music Studio 1.1

## Direction

A dim concert stage with rose and periwinkle team colours, Manrope typography,
soft surfaces and restrained animated lighting. All visible buttons use the
React Bits SpecularButton component; sliders use WakeSlider and settings use
SquishSwitch. Dialog behaviour comes from Radix, with the studio's own visual
system. Native audio controls, selects, range inputs and file controls are not
shown. File import opens the operating system's file picker.

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

## Follow-up scope

- Validate the visual direction with the host before adding more competitions.
- Separate host and audience devices with authoritative room state.
- Add a supported full-track playback path, exact word alignment, and clip editing.
- Integrate account/guest flows into the new shell.
