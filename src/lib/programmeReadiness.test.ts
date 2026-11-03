import { expect, it, vi } from "vitest";
import { checkProgrammeAudio, type SongReadiness } from "./programmeReadiness";
import type { PreparedSong } from "./preparedSongs";
import type { MediaProbeOptions } from "./mediaProbe";

const song = (id: number, local = true): PreparedSong => ({
  schema: 1,
  savedAt: 1000,
  offset: 0,
  target: 1,
  duration: 30,
  leadInSeconds: 7,
  ...(local
    ? { file: new Blob(["original audio"], { type: "audio/wav" }) }
    : {}),
  track: {
    id,
    title: `Own fixture ${id}`,
    artist: "Fixture",
    album: "",
    cover: "",
    duration: 200,
    link: "",
    preview: "https://example.invalid/old.mp3",
    lyricsStatus: "imported",
    cues: [
      { startMs: 4000, endMs: 7000, text: "Original opening" },
      { startMs: 10000, endMs: 13000, text: "Original answer" },
    ],
  },
});
const probe = vi.fn(
  async (_url: string, _signal: AbortSignal, options: MediaProbeOptions) => {
    expect(options.positions?.(30)).toEqual([3, 9.9]);
    return 30;
  },
);

it("checks own files in programme order without provider access or modifying preparations", async () => {
  const stored = [song(5), song(8)],
    lookup = vi.fn(),
    createURL = vi.fn((file: Blob) => `blob:${file.size}`),
    revokeURL = vi.fn(),
    events: SongReadiness[] = [];
  const before = stored.map((s) => ({ ...s, track: structuredClone(s.track) }));
  const results = await checkProgrammeAudio(
    [8, 5],
    new AbortController().signal,
    (r) => events.push(r),
    {
      read: async (id) => stored.find((s) => s.track.id === id)!,
      lookup,
      inspect: probe,
      createURL,
      revokeURL,
    },
  );
  expect(results.map((r) => [r.id, r.status, r.source, r.seconds])).toEqual([
    [8, "ready", "local", 7],
    [5, "ready", "local", 7],
  ]);
  expect(lookup).not.toHaveBeenCalled();
  expect(createURL).toHaveBeenCalledTimes(2);
  expect(revokeURL).toHaveBeenCalledTimes(2);
  expect(stored).toEqual(before);
  expect(events.filter((r) => r.status === "ready").map((r) => r.id)).toEqual([
    8, 5,
  ]);
});

it("reports a broken middle source and continues checking later songs, releasing every blob", async () => {
  const revokeURL = vi.fn();
  const results = await checkProgrammeAudio(
    [1, 2, 3],
    new AbortController().signal,
    () => {},
    {
      read: async (id) => song(id),
      createURL: () => "blob:fixture",
      revokeURL,
      inspect: async (url, signal, options) => {
        if (revokeURL.mock.calls.length === 1)
          throw new Error("Codec unavailable");
        return probe(url, signal, options);
      },
    },
  );
  expect(results.map((r) => r.status)).toEqual(["ready", "error", "ready"]);
  expect(results[1].message).toBe("Codec unavailable");
  expect(revokeURL).toHaveBeenCalledTimes(3);
});

it("refreshes previews and checks only the fresh URL, keeping their network requirement", async () => {
  const stored = song(5, false),
    urls: string[] = [];
  const results = await checkProgrammeAudio(
    [5],
    new AbortController().signal,
    () => {},
    {
      read: async () => stored,
      lookup: async () => ({
        ...stored.track,
        cues: [],
        preview: "https://example.invalid/fresh.mp3",
      }),
      inspect: async (url, signal, options) => {
        urls.push(url);
        return probe(url, signal, options);
      },
    },
  );
  expect(urls).toEqual(["https://example.invalid/fresh.mp3"]);
  expect(results[0]).toMatchObject({
    status: "ready",
    source: "preview",
    seconds: 7,
  });
  expect(results[0].message).toContain("потрібна мережа");
  expect(stored.track.preview).toContain("old");
});

it("detects missing preparation, wrong preview identity and out-of-range real media", async () => {
  const results = await checkProgrammeAudio(
    [1, 2, 3],
    new AbortController().signal,
    () => {},
    {
      read: async (id) => (id === 1 ? null : song(id, id === 3)),
      lookup: async () => song(99).track,
      createURL: () => "blob:short",
      revokeURL: vi.fn(),
      inspect: async (_url, _signal, options) => {
        options.positions?.(6);
        return 6;
      },
    },
  );
  expect(results.map((r) => r.status)).toEqual(["error", "error", "error"]);
  expect(results[0].source).toBe("missing");
  expect(results[1].message).toContain("Прев’ю недоступне");
  expect(results[2].message).toContain("Рядок виходить за межі");
});

it("aborts an in-flight check without publishing success or inspecting the next song", async () => {
  const controller = new AbortController(),
    events: SongReadiness[] = [],
    read = vi.fn(async (id) => song(id)),
    revokeURL = vi.fn();
  await expect(
    checkProgrammeAudio([1, 2], controller.signal, (r) => events.push(r), {
      read,
      createURL: () => "blob:fixture",
      revokeURL,
      inspect: async () => {
        controller.abort();
        return 30;
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(read).toHaveBeenCalledTimes(1);
  expect(events.some((r) => r.status === "ready" || r.status === "error")).toBe(
    false,
  );
  expect(revokeURL).toHaveBeenCalledWith("blob:fixture");
});
