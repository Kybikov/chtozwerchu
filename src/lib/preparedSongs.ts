import type { Track } from "./music";
import { validWordTiming } from "./wordTiming";
import { validClipLength } from "./roundClip";

export type PreparedSummary = {
  id: number;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  local: boolean;
};
export type PreparedSong = {
  leadInSeconds?: number;
  schema: 1;
  track: Track;
  offset: number;
  target: number;
  duration: number;
  file?: Blob;
  savedAt: number;
};
export const preparedLimit = 40;

export async function refreshPreparedPreview(
  song: PreparedSong,
  lookup: (id: number) => Promise<Track>,
): Promise<PreparedSong> {
  if (song.file) return song;
  const current = await lookup(song.track.id);
  if (current.id !== song.track.id || !/^https:\/\//.test(current.preview))
    throw new Error(
      "Прев’ю цього запису більше недоступне. Додай власний аудіофайл або підготуй інший запис.",
    );
  return { ...song, track: { ...song.track, preview: current.preview } };
}

export function validPrepared(song: PreparedSong): boolean {
  const t = song?.track;
  if (
    song?.schema !== 1 ||
    (song.leadInSeconds !== undefined &&
      !validClipLength(song.leadInSeconds)) ||
    !t ||
    !Number.isSafeInteger(t.id) ||
    t.id <= 0 ||
    t.id > 999999999999999 ||
    typeof t.title !== "string" ||
    !t.title.trim() ||
    t.title.length > 240 ||
    typeof t.artist !== "string" ||
    t.artist.length > 240 ||
    typeof t.cover !== "string" ||
    t.cover.length > 2048 ||
    (t.cover !== "" && !t.cover.startsWith("https://")) ||
    !Array.isArray(t.cues) ||
    !t.cues.length ||
    t.cues.length > 1000 ||
    !Number.isFinite(song.duration) ||
    song.duration < 1 ||
    song.duration > 86400 ||
    !Number.isSafeInteger(song.offset) ||
    Math.abs(song.offset) > 86400000 ||
    !Number.isInteger(song.target) ||
    !Number.isFinite(song.savedAt) ||
    song.savedAt <= 0 ||
    !t.cues[song.target]
  )
    return false;
  if (
    song.file !== undefined &&
    (!(song.file instanceof Blob) ||
      !song.file.size ||
      song.file.size > 150 * 1024 * 1024)
  )
    return false;
  if (
    !song.file &&
    (typeof t.preview !== "string" || !/^https:\/\//.test(t.preview))
  )
    return false;
  if (
    !t.cues.every(
      (cue, i) =>
        !!cue &&
        Number.isSafeInteger(cue.startMs) &&
        Number.isSafeInteger(cue.endMs) &&
        cue.startMs >= 0 &&
        cue.endMs > cue.startMs &&
        typeof cue.text === "string" &&
        !!cue.text.trim() &&
        cue.text.length <= 2000 &&
        (!i || cue.startMs > t.cues[i - 1].startMs) &&
        (!cue.words ||
          (Array.isArray(cue.words) &&
            cue.words.every(
              (w) =>
                !!w &&
                typeof w.text === "string" &&
                Number.isFinite(w.startMs) &&
                Number.isFinite(w.endMs),
            ) &&
            validWordTiming(cue, cue.words))),
    )
  )
    return false;
  const stop = (t.cues[song.target].startMs - song.offset) / 1000;
  return stop > 0.3 && stop < song.duration - 0.2;
}

export const preparedSummary = (song: PreparedSong): PreparedSummary => ({
  id: song.track.id,
  title: song.track.title,
  artist: song.track.artist,
  cover: song.track.cover,
  duration: song.duration,
  local: !!song.file,
});

let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("khz-prepared-songs", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("songs", { keyPath: "track.id" });
      request.onerror = () => {
        opening = undefined;
        reject(new Error("Не вдалося відкрити підготовлені пісні."));
      };
      request.onblocked = () => {
        opening = undefined;
        reject(new Error("Закрий іншу вкладку студії й спробуй ще раз."));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    });
  return opening;
}

export async function listPrepared(): Promise<PreparedSummary[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("songs").objectStore("songs").getAll();
    request.onerror = () =>
      reject(new Error("Не вдалося прочитати підготовлені пісні."));
    request.onsuccess = () =>
      resolve(
        (request.result as PreparedSong[])
          .filter(validPrepared)
          .sort((a, b) => b.savedAt - a.savedAt)
          .map(preparedSummary),
      );
  });
}

export async function readPrepared(id: number): Promise<PreparedSong | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("songs").objectStore("songs").get(id);
    request.onerror = () =>
      reject(new Error("Не вдалося відкрити цю підготовку."));
    request.onsuccess = () => {
      const value = request.result as PreparedSong | undefined;
      resolve(value && validPrepared(value) ? value : null);
    };
  });
}

export async function savePrepared(song: PreparedSong) {
  if (!validPrepared(song))
    throw new Error("Перевір аудіо, прив’язку та рядок перед збереженням.");
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("songs", "readwrite"),
      store = tx.objectStore("songs");
    let message =
      "Не вдалося зберегти підготовку. Перевір вільне місце на пристрої.";
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error(message));
    tx.onerror = () => {};
    const existing = store.get(song.track.id);
    existing.onsuccess = () => {
      const count = store.count();
      count.onsuccess = () => {
        if (!existing.result && count.result >= preparedLimit) {
          message = `У наборі вже ${preparedLimit} пісень. Прибери непотрібну підготовку.`;
          tx.abort();
        } else store.put(song);
      };
    };
  });
}

export async function removePrepared(id: number) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("songs", "readwrite");
    tx.objectStore("songs").delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(new Error("Не вдалося прибрати підготовку."));
  });
}
