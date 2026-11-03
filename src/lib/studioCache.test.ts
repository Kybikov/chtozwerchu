import { describe, expect, it, vi } from "vitest";
import type { Track } from "./music";
import { resolveStudioTrack, canRestoreStudioTrack } from "./studioCache";

const track = (): Track => ({
  id: 1,
  title: "Own test song",
  artist: "Fixture",
  album: "",
  cover: "",
  duration: 30,
  preview: "https://example.invalid/expired.mp3",
  link: "",
  lyricsStatus: "imported",
  cues: [
    {
      startMs: 4000,
      endMs: 8000,
      text: "Own words",
      words: [
        { startMs: 4100, endMs: 4500, text: "Own " },
        { startMs: 6200, endMs: 7000, text: "words" },
      ],
    },
  ],
});
const audio = () => ({ trackId: 1, file: new Blob(["original audio"]) });

describe("studio restoration", () => {
  it("remembers preview selection without deleting the own file or silently switching sources offline", async () => {
    const saved = track(),
      file = audio();
    const snapshot = [saved, file, saved.cues, "preview"];
    const lookup = vi.fn(async () => ({
      ...saved,
      preview: "https://example.invalid/fresh.mp3",
    }));
    const restored = await resolveStudioTrack(1, true, snapshot, lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(restored.source).toBe("preview");
    expect(restored.audio).toBeUndefined();
    expect(restored.savedAudio?.file).toBe(file.file);
    expect(restored.track.preview).toContain("fresh");
    expect(restored.sourceUnavailable).toBe(false);
    const offline = await resolveStudioTrack(1, true, snapshot, async () => {
      throw new Error("Offline");
    });
    expect(offline.source).toBe("preview");
    expect(offline.sourceUnavailable).toBe(true);
    expect(offline.audio).toBeUndefined();
    expect(offline.savedAudio?.file).toBe(file.file);
    expect(canRestoreStudioTrack(1, snapshot)).toBe(true);
    expect(
      canRestoreStudioTrack(1, [
        saved,
        { ...file, trackId: 2 },
        undefined,
        "local",
      ]),
    ).toBe(false);
  });
  it("never applies full-file calibration to a preview if a selected local file is missing", async () => {
    const saved = track(),
      lookup = vi.fn(async () => saved);
    const restored = await resolveStudioTrack(
      1,
      true,
      [saved, undefined, undefined, "local"],
      lookup,
    );
    expect(restored.source).toBe("local");
    expect(restored.audio).toBeUndefined();
    expect(restored.sourceUnavailable).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("restores own audio immediately without starting a provider request, preserving word gaps", async () => {
    const saved = track(),
      file = audio();
    const lookup = vi.fn(() => new Promise<Track>(() => {}));
    const result = await resolveStudioTrack(
      1,
      true,
      [saved, file, saved.cues],
      lookup,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(result.fromDevice).toBe(true);
    expect(result.retimed).toBe(false);
    expect(result.audio?.file).toBe(file.file);
    expect(result.track.cues).toEqual(saved.cues);
    expect(result.track.cues[0].words?.[1].startMs).toBe(6200);
  });

  it("refreshes provider previews and explicit selections, with own-file fallback on failure", async () => {
    const saved = track(),
      fresh = { ...saved, preview: "https://example.invalid/fresh.mp3" };
    const lookup = vi.fn(async () => fresh);
    const preview = await resolveStudioTrack(1, true, [saved], lookup);
    expect(preview.track.preview).toBe(fresh.preview);
    expect(preview.fromDevice).toBe(false);
    await resolveStudioTrack(1, false, [saved, audio()], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
    const failed = async () => {
      throw new Error("Provider unavailable");
    };
    expect(
      (await resolveStudioTrack(1, false, [saved, audio()], failed)).fromDevice,
    ).toBe(true);
    await expect(resolveStudioTrack(1, true, [saved], failed)).rejects.toThrow(
      "Provider unavailable",
    );
  });

  it("never opens a mismatched, empty or malformed cached source", async () => {
    const saved = track();
    const failed = async () => {
      throw new Error("No network");
    };
    for (const snapshot of [
      [saved, { ...audio(), trackId: 2 }],
      [saved, { ...audio(), file: new Blob() }],
      [saved, { ...audio(), file: { size: 10 } }],
      [{ ...saved, id: 2 }, audio()],
      [{ ...saved, cues: [null] }, audio()],
      [{ ...saved, cues: [{ ...saved.cues[0], words: [null] }] }, audio()],
      [{ ...saved, cues: [{ ...saved.cues[0], endMs: -1 }] }, audio()],
    ])
      await expect(
        resolveStudioTrack(1, true, snapshot, failed),
      ).rejects.toThrow("No network");
  });

  it("invalidates calibration only for an actual line change and ignores corrupt imported lyrics", async () => {
    const saved = track();
    const lookup = vi.fn(async () => saved);
    const changed = [{ startMs: 5000, endMs: 9000, text: "Changed answer" }];
    const moved = await resolveStudioTrack(
      1,
      true,
      [saved, audio(), changed],
      lookup,
    );
    expect(moved.retimed).toBe(true);
    expect(moved.track.cues).toEqual(changed);
    const corrupt = await resolveStudioTrack(
      1,
      true,
      [saved, audio(), [null]],
      lookup,
    );
    expect(corrupt.track.cues).toEqual(saved.cues);
    expect(corrupt.retimed).toBe(false);
    const legacy = {
      ...saved,
      album: undefined,
      link: undefined,
      lyricsStatus: undefined,
    };
    const restored = await resolveStudioTrack(
      1,
      true,
      [legacy, audio()],
      lookup,
    );
    expect(restored.fromDevice).toBe(true);
    expect(restored.track.album).toBe("");
    expect(lookup).not.toHaveBeenCalled();
  });
});
