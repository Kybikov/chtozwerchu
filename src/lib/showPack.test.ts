import { describe, expect, it } from "vitest";
import { buildShowPack, readShowPack, crc32, packFilename } from "./showPack";
import type { PreparedSong } from "./preparedSongs";

export const song = (id = 1): PreparedSong => ({
  schema: 1,
  savedAt: 1000,
  duration: 12,
  offset: 250,
  target: 1,
  leadInSeconds: 5,
  file: new File([`original audio ${id}`], `Власна пісня ${id}.wav`, {
    type: "audio/wav",
  }),
  track: {
    id,
    title: `Пісня ${id}`,
    artist: "Свій виконавець",
    album: "",
    cover: "",
    duration: 12,
    preview: "https://example.invalid/expired.mp3",
    link: "",
    lyricsStatus: "imported",
    lyricsSync: "mixed",
    cues: [
      { startMs: 1000, endMs: 3000, text: "Початок" },
      {
        startMs: 5000,
        endMs: 8000,
        text: "Своя музика",
        words: [
          { startMs: 5050, endMs: 5400, text: "Своя " },
          { startMs: 6500, endMs: 7000, text: "музика" },
        ],
      },
    ],
  },
});
const rawPack = (manifest: unknown, media: Blob[] = []) => {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)),
    header = new Uint8Array(16),
    view = new DataView(header.buffer);
  header.set(new TextEncoder().encode("KHZPACK1"));
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, crc32(bytes), true);
  return new Blob([header, bytes, ...media]);
};
const unpackManifest = async (file: Blob) => {
  const size = new DataView(await file.slice(0, 16).arrayBuffer()).getUint32(
    8,
    true,
  );
  return JSON.parse(await file.slice(16, 16 + size).text());
};
describe("portable show packs", () => {
  it("preserves browser container MIME types used by supported audio files", async () => {
    const fixture = {
      ...song(),
      file: new File(["own m4a media"], "Own.m4a", { type: "video/mp4" }),
    };
    const restored = await readShowPack(
      await buildShowPack({ songs: [fixture] }),
    );
    expect(restored.songs[0].file?.type).toBe("video/mp4");
    expect(await restored.songs[0].file?.text()).toBe("own m4a media");
  });
  it("round-trips full audio, exact word gaps, calibration and a four-song programme", async () => {
    const songs = [1, 2, 3, 4].map(song),
      programme = { title: "Наш вечір", trackIds: [2, 4, 1, 3] };
    const file = await buildShowPack({ songs, programme }),
      restored = await readShowPack(file);
    expect(restored.programme).toEqual(programme);
    for (const [i, value] of restored.songs.entries()) {
      expect(value.track).toEqual(songs[i].track);
      expect(value.offset).toBe(250);
      expect(value.target).toBe(1);
      expect(value.leadInSeconds).toBe(5);
      expect(value.file instanceof File).toBe(true);
      expect((value.file as File).name).toBe((songs[i].file as File).name);
      expect(value.file?.type).toBe("audio/wav");
      expect(await value.file!.arrayBuffer()).toEqual(
        await songs[i].file!.arrayBuffer(),
      );
      expect(value.track.cues[1].words?.[1].startMs).toBe(6500);
    }
  });
  it("keeps preview-only preparations explicit and never includes live account or room fields", async () => {
    const fixture = {
      ...song(),
      file: undefined,
      ownerAccountId: "PRIVATE_OWNER",
      stationToken: "PRIVATE_TOKEN",
      track: { ...song().track, private: "PRIVATE_TRACK" },
    };
    const file = await buildShowPack({ songs: [fixture] });
    const metadata = JSON.stringify(await unpackManifest(file));
    expect(metadata).not.toContain("PRIVATE_");
    expect((await readShowPack(file)).songs[0].file).toBeUndefined();
  });
  it("checks a standard CRC vector and rejects damaged headers, metadata, media, truncation and appended bytes", async () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const file = await buildShowPack({ songs: [song()] }),
      bytes = new Uint8Array(await file.arrayBuffer());
    for (const index of [0, 17, bytes.length - 1]) {
      const changed = bytes.slice();
      changed[index] ^= 1;
      await expect(readShowPack(new Blob([changed]))).rejects.toThrow();
    }
    await expect(readShowPack(file.slice(0, file.size - 1))).rejects.toThrow();
    await expect(
      readShowPack(new Blob([file, new Uint8Array([1])])),
    ).rejects.toThrow();
  });
  it("rejects invalid preparation, duplicate identities, unknown versions and a programme referring outside the pack", async () => {
    const built = await buildShowPack({ songs: [song()] }),
      manifest = await unpackManifest(built),
      data = song().file!;
    for (const changed of [
      { ...manifest, version: 2 },
      { ...manifest, songs: [manifest.songs[0], manifest.songs[0]] },
      { ...manifest, songs: [{ ...manifest.songs[0], target: 999 }] },
      {
        ...manifest,
        songs: [
          {
            ...manifest.songs[0],
            track: { ...manifest.songs[0].track, cues: [null] },
          },
        ],
      },
      { ...manifest, programme: { title: "Wrong", trackIds: [1, 2, 3, 4] } },
    ])
      await expect(
        readShowPack(
          rawPack(changed, changed.songs.length === 2 ? [data, data] : [data]),
        ),
      ).rejects.toThrow();
    await expect(buildShowPack({ songs: [song(), song()] })).rejects.toThrow();
  });
  it("rejects oversized declarations and path-like media names before accepting a package", async () => {
    const manifest = await unpackManifest(
      await buildShowPack({ songs: [song()] }),
    );
    for (const patch of [
      { name: "../track.wav" },
      { size: 150 * 1024 * 1024 + 1 },
      { type: "text/html" },
      { crc32: -1 },
    ]) {
      const entry = {
        ...manifest.songs[0],
        media: { ...manifest.songs[0].media, ...patch },
      };
      await expect(
        readShowPack(rawPack({ ...manifest, songs: [entry] }, [song().file!])),
      ).rejects.toThrow();
    }
    const header = new Uint8Array(16);
    header.set(new TextEncoder().encode("KHZPACK1"));
    new DataView(header.buffer).setUint32(8, 5 * 1024 * 1024, true);
    await expect(readShowPack(new Blob([header]))).rejects.toThrow();
    expect(packFilename('../Весілля:"/')).not.toMatch(/[<>:"/\\|?*]/);
  });
  it("cancels chunked export and verification without returning a partial pack", async () => {
    const fixture = {
      ...song(),
      file: new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "audio/wav" }),
    };
    const exportController = new AbortController();
    await expect(
      buildShowPack({ songs: [fixture] }, exportController.signal, () =>
        exportController.abort(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    const file = await buildShowPack({ songs: [fixture] }),
      importController = new AbortController();
    await expect(
      readShowPack(file, importController.signal, () =>
        importController.abort(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
