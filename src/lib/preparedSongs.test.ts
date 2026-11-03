import { describe, it, expect } from "vitest";
import {
  preparedSummary,
  validPrepared,
  refreshPreparedPreview,
  type PreparedSong,
} from "./preparedSongs";

const song = (): PreparedSong => ({
  schema: 1,
  savedAt: 1000,
  duration: 12,
  offset: 250,
  target: 1,
  file: new Blob(["fixture original audio"]),
  track: {
    id: 1,
    title: "Original fixture",
    artist: "Fixture",
    album: "",
    cover: "",
    duration: 12,
    preview: "",
    link: "",
    lyricsStatus: "imported",
    cues: [
      { startMs: 0, endMs: 2000, text: "Visible lyric" },
      {
        startMs: 4000,
        endMs: 6000,
        text: "Own answer",
        words: [
          { startMs: 4050, endMs: 4400, text: "Own " },
          { startMs: 5100, endMs: 5600, text: "answer" },
        ],
      },
    ],
  },
});
describe("prepared songs", () => {
  it("refreshes an expiring preview without replacing the calibrated lyrics, and never calls the provider for a local file", async () => {
    const local = song();
    const lookup = async () => {
      throw new Error("Provider unavailable");
    };
    expect(await refreshPreparedPreview(local, lookup)).toBe(local);
    const preview = {
      ...local,
      leadInSeconds: 10,
      file: undefined,
      track: { ...local.track, preview: "https://example.invalid/expired.mp3" },
    };
    const refreshed = await refreshPreparedPreview(preview, async () => ({
      ...local.track,
      preview: "https://example.invalid/fresh.mp3",
      cues: [],
    }));
    expect(refreshed.track.preview).toContain("fresh.mp3");
    expect(refreshed.track.cues).toBe(preview.track.cues);
    expect(refreshed.offset).toBe(250);
    expect(refreshed.target).toBe(1);
    expect(refreshed.leadInSeconds).toBe(10);
    await expect(
      refreshPreparedPreview(preview, async () => ({
        ...local.track,
        id: 2,
        preview: "https://example.invalid/wrong.mp3",
      })),
    ).rejects.toThrow();
  });
  it("keeps the exact offset, target and word gaps while sharing only a safe catalogue", () => {
    const s = song();
    expect(validPrepared(s)).toBe(true);
    expect(preparedSummary(s)).toEqual({
      id: 1,
      title: "Original fixture",
      artist: "Fixture",
      cover: "",
      duration: 12,
      local: true,
    });
    expect(JSON.stringify(preparedSummary(s))).not.toContain("Own answer");
    expect(s.track.cues[1].words?.[1].startMs).toBe(5100);
    expect(s.offset).toBe(250);
    expect(validPrepared({ ...s, leadInSeconds: 15 })).toBe(true);
    expect(validPrepared({ ...s, leadInSeconds: 6 })).toBe(false);
  });
  it("rejects unplayable calibration, missing media and malformed saved lyrics", () => {
    const s = song();
    expect(validPrepared({ ...s, offset: 4000 })).toBe(false);
    expect(validPrepared({ ...s, duration: 3 })).toBe(false);
    expect(validPrepared({ ...s, file: undefined })).toBe(false);
    expect(
      validPrepared({
        ...s,
        file: undefined,
        track: { ...s.track, preview: "https://example.invalid/preview.mp3" },
      }),
    ).toBe(true);
    expect(
      validPrepared({ ...s, track: { ...s.track, cues: [null] as never } }),
    ).toBe(false);
    s.track.cues[1].words![1].startMs = 4200;
    expect(validPrepared(s)).toBe(false);
  });
});
