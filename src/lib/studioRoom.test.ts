import { describe, expect, it } from "vitest";
import { freshSession } from "./music";
import { roomRemaining, roomScene, type RoomState } from "./studioRoom";

function fixture(): RoomState {
  return {
    session: { ...freshSession(), aligned: true, target: 1 },
    track: {
      id: 1,
      title: "Fixture",
      artist: "Test",
      album: "",
      cover: "",
      duration: 12,
      preview: "",
      link: "",
      lyricsStatus: "imported",
      cues: [
        { startMs: 0, endMs: 3000, text: "Visible line" },
        { startMs: 3000, endMs: 6000, text: "Hidden answer" },
      ],
    },
    audio: {
      position: 3.1,
      duration: 12,
      playing: true,
      ready: true,
      local: true,
      volume: 65,
    },
    phase: "playing",
    awarded: null,
    timer: { leftMs: 20000, deadline: 120000, paused: false },
    version: 1,
    effects: true,
    needsTrack: false,
    notice: "",
  };
}
describe("network room projections", () => {
  it("stops playback and marks a cached scene paused while disconnected", () => {
    const s = fixture();
    const frozen = roomScene(s, 107001, false);
    expect(frozen.playing).toBe(false);
    expect(frozen.timerPaused).toBe(true);
    expect(frozen.remaining).toBe(13);
    expect(s.audio.playing).toBe(true);
    expect(s.timer.paused).toBe(false);
  });
  it("never projects the target as a live lyric or answer before adjudication", () => {
    const s = fixture();
    for (const phase of ["ready", "playing", "answer"] as const) {
      s.phase = phase;
      const scene = roomScene(s, 100000);
      expect(JSON.stringify(scene)).not.toContain("Hidden answer");
      expect(scene.answer).toBeUndefined();
    }
  });
  it("shows earlier lyrics only during playback", () => {
    const s = fixture();
    s.audio.position = 1;
    expect(roomScene(s, 100000).lyric).toBe("Visible line");
    s.phase = "answer";
    expect(roomScene(s, 100000).lyric).toBe("");
  });
  it("reveals the recorded answer rather than a subsequently selected target", () => {
    const s = fixture();
    s.phase = "result";
    s.session.history = [
      {
        round: 1,
        team: "girls",
        awarded: "boys",
        track: "Original song",
        line: "Recorded answer",
        trackId: 2,
        target: 0,
      },
    ];
    const scene = roomScene(s, 100000);
    expect(scene.answer).toBe("Recorded answer");
    expect(scene.track).toBe("Original song");
  });
  it("uses the server deadline and retains paused remaining time", () => {
    const s = fixture();
    expect(roomRemaining(s, 107001)).toBe(13);
    s.timer = { leftMs: 12500, deadline: 0, paused: true };
    expect(roomRemaining(s, 99999999)).toBe(13);
    s.timer = { leftMs: 20000, deadline: 120000, paused: false };
    expect(roomRemaining(s, 121000)).toBe(0);
  });
});
