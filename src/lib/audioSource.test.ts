import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePreview, probeAudio } from "./audioSource";
import type { Track } from "./music";

const track = (): Track => ({
  id: 5,
  title: "Own fixture",
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
      text: "Own answer",
      words: [
        { startMs: 4100, endMs: 4400, text: "Own " },
        { startMs: 6500, endMs: 7000, text: "answer" },
      ],
    },
  ],
});

class Probe extends EventTarget {
  duration = 30;
  preload = "";
  src = "";
  load = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = "";
  });
}
afterEach(() => vi.useRealTimers());
describe("preview source transition", () => {
  it("fetches and verifies the fresh URL before returning, keeping host lyrics and silent gaps", async () => {
    const saved = track();
    const verified: string[] = [];
    const result = await preparePreview(
      saved,
      async (id) => ({
        ...saved,
        id,
        cues: [],
        preview: "https://example.invalid/fresh.mp3",
      }),
      new AbortController().signal,
      async (url) => {
        verified.push(url);
      },
    );
    expect(verified).toEqual(["https://example.invalid/fresh.mp3"]);
    expect(result.preview).toContain("fresh");
    expect(result.cues).toBe(saved.cues);
    expect(result.cues[0].words?.[1].startMs).toBe(6500);
    expect(saved.preview).toContain("expired");
  });
  it("rejects unavailable, mismatched and undecodable sources without mutating preparation", async () => {
    const saved = track(),
      probe = vi.fn(async () => {});
    for (const response of [
      { ...saved, id: 6 },
      { ...saved, preview: "" },
      { ...saved, preview: "http://example.invalid/file.mp3" },
    ])
      await expect(
        preparePreview(
          saved,
          async () => response,
          new AbortController().signal,
          probe,
        ),
      ).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
    await expect(
      preparePreview(
        saved,
        async () => saved,
        new AbortController().signal,
        async () => {
          throw new Error("Decode failed");
        },
      ),
    ).rejects.toThrow("Decode failed");
    expect(saved.cues[0].text).toBe("Own answer");
  });
  it("cancels an obsolete lookup before opening another audio request", async () => {
    const controller = new AbortController(),
      probe = vi.fn(async () => {});
    const promise = preparePreview(
      track(),
      async () => {
        controller.abort();
        return track();
      },
      controller.signal,
      probe,
    );
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(probe).not.toHaveBeenCalled();
  });
  it("requires playable media and releases its request on success", async () => {
    const audio = new Probe();
    const promise = probeAudio(
      "https://example.invalid/test.mp3",
      new AbortController().signal,
      () => audio as unknown as HTMLAudioElement,
    );
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(audio.removeAttribute).not.toHaveBeenCalled();
    audio.dispatchEvent(new Event("canplay"));
    await promise;
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalledTimes(2);
  });
  it("releases failed, timed-out, invalid-duration and aborted probes", async () => {
    vi.useFakeTimers();
    for (const outcome of ["error", "timeout", "duration", "abort"]) {
      const audio = new Probe(),
        controller = new AbortController();
      const promise = probeAudio(
        "https://example.invalid/test.mp3",
        controller.signal,
        () => audio as unknown as HTMLAudioElement,
      );
      const rejection = expect(promise).rejects.toThrow();
      if (outcome === "timeout") await vi.advanceTimersByTimeAsync(12000);
      else if (outcome === "abort") controller.abort();
      else if (outcome === "duration") {
        audio.duration = Infinity;
        audio.dispatchEvent(new Event("canplay"));
      } else audio.dispatchEvent(new Event("error"));
      await rejection;
      expect(audio.src).toBe("");
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});
