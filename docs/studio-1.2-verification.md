# Studio 1.2 verification

Verified on 2 November 2026 against the local development build and the private
production build at the existing loopback preview URL.

## Automated

- Production build and TypeScript, including unused locals/parameters: pass.
- Vitest: 13 passing tests. Audio boundaries, standard/enhanced LRC, malformed
  word timelines, idempotent awards, correcting awards, stale results, eligible
  targets, wins and ties.
- Production dependency audit: no vulnerabilities reported.
- PWA precache: 28 entries, approximately 1 MB, including the stage WebP.

## Browser

- Four-turn matches reach the correct final score, including a no-award turn.
- Repeating an award with a double-click records one result and does not advance.
- Undo removes the current award and allows a corrected result.
- A paused answer clock stays at the same remaining time until resumed.
- A scored round and a completed final survive reloads; music stays paused.
- Starting again after the final clears history and shows round 1 in preparation.
- Enhanced LRC word highlighting follows the actual audio clock. At 7.88 seconds
  the test word starting at 7.00 seconds was active; the preceding word was sung.
- Separate audience window receives public scores, phase and countdown, with no
  host controls or revealed answer during the answer phase. Host reload reconnects.
- TV layout checked at 1280 × 720; final content fits above the stage footer.
- Host layout and settings checked at 390 px; document has no horizontal overflow.
- No visible native audio, select or range controls. Browser error/warning log empty.
- PWA update applied through the settings action; the served and browser-loaded
  script hash matched the current build (`index-BlQd6XMj.js`).

Test audio and lyrics are synthetic fixtures under ignored `output/playwright/`.
They are not bundled into the application and are not presented as real song
alignment. The review URL retains the real Deezer track and its original lyrics.

The network-room, phone-remote, account integration and full streaming work listed
in music-studio.md remains follow-up scope. This verification covers the local
music match, not completion of the whole platform.
