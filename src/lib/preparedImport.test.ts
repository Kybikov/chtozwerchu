import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  importPreparedBatch,
  readPreparedCollection,
  readPrepared,
  savePrepared,
  type PreparedSong,
} from "./preparedSongs";

const song = (id: number): PreparedSong => ({
  schema: 1,
  savedAt: 1000,
  duration: 12,
  offset: 250,
  target: 1,
  file: new Blob([`own audio ${id}`], { type: "audio/wav" }),
  track: {
    id,
    title: `Own ${id}`,
    artist: "Fixture",
    album: "",
    cover: "",
    duration: 12,
    preview: "",
    link: "",
    lyricsStatus: "imported",
    cues: [
      { startMs: 1000, endMs: 3000, text: "Intro" },
      { startMs: 5000, endMs: 8000, text: "Answer" },
    ],
  },
});
beforeEach(async () => {
  await readPreparedCollection();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("khz-prepared-songs", 1);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction("songs", "readwrite");
      tx.objectStore("songs").clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
});
describe("atomic prepared imports", () => {
  it("adds the complete pack and replaces only explicitly reviewed revisions", async () => {
    await savePrepared(song(1));
    await importPreparedBatch(
      [{ ...song(1), offset: 100, savedAt: 2000 }, song(2)],
      new Map([[1, 1000]]),
    );
    expect((await readPreparedCollection()).length).toBe(2);
    expect((await readPrepared(1))?.offset).toBe(100);
    expect(await (await readPrepared(2))?.file?.text()).toBe("own audio 2");
  });
  it("keeps all existing songs when a replacement changed after review", async () => {
    await savePrepared({ ...song(1), savedAt: 2000 });
    await expect(
      importPreparedBatch(
        [{ ...song(1), offset: 100 }, song(2)],
        new Map([[1, 1000]]),
      ),
    ).rejects.toThrow("Бібліотека змінилася");
    expect((await readPrepared(1))?.savedAt).toBe(2000);
    expect(await readPrepared(2)).toBeNull();
  });
  it("rejects unreviewed replacements without adding the nonconflicting songs", async () => {
    await savePrepared(song(1));
    await expect(importPreparedBatch([song(1), song(2)])).rejects.toThrow(
      "Бібліотека змінилася",
    );
    expect((await readPreparedCollection()).map((s) => s.track.id)).toEqual([
      1,
    ]);
  });
  it("checks the complete library limit before changing a replacement", async () => {
    await importPreparedBatch(
      Array.from({ length: 40 }, (_, i) => song(i + 1)),
    );
    await expect(
      importPreparedBatch(
        [{ ...song(1), offset: 100 }, song(41)],
        new Map([[1, 1000]]),
      ),
    ).rejects.toThrow("до 40");
    expect((await readPreparedCollection()).length).toBe(40);
    expect((await readPrepared(1))?.offset).toBe(250);
  });
  it("rolls back a write failure after an earlier song was queued", async () => {
    await savePrepared(song(1));
    const uncloneable = { ...song(3), unexpected: () => {} };
    await expect(importPreparedBatch([song(2), uncloneable])).rejects.toThrow(
      "Пакет не збережено",
    );
    expect((await readPreparedCollection()).map((s) => s.track.id)).toEqual([
      1,
    ]);
  });
});
