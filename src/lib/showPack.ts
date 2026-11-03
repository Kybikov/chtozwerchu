import type { Cue, Track } from "./music";
import { validProgramme, type Programme } from "./programme";
import {
  preparedLimit,
  validPrepared,
  type PreparedSong,
} from "./preparedSongs";

const magic = new TextEncoder().encode("KHZPACK1");
const headerSize = 16;
const manifestLimit = 4 * 1024 * 1024;
export const packSizeLimit = 1024 * 1024 * 1024;
const chunkSize = 1024 * 1024;
export type PackProgress = {
  bytes: number;
  total: number;
  song: number;
  songs: number;
};
export type ShowPack = { songs: PreparedSong[]; programme?: Programme };
type Media = { name: string; type: string; size: number; crc32: number };
type PackedSong = Omit<PreparedSong, "file"> & { media?: Media };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++)
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function updateChecksum(bytes: Uint8Array, crc: number) {
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
export const crc32 = (bytes: Uint8Array) =>
  (updateChecksum(bytes, 0xffffffff) ^ 0xffffffff) >>> 0;
const cancelled = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};
const invalid = () =>
  new Error(
    "Пакет пошкоджений або має непідтримуваний формат. Обери файл .khz, створений у студії.",
  );

async function checksum(
  file: Blob,
  signal?: AbortSignal,
  progress?: (bytes: number) => void,
) {
  let crc = 0xffffffff;
  for (let at = 0; at < file.size; at += chunkSize) {
    cancelled(signal);
    crc = updateChecksum(
      new Uint8Array(await file.slice(at, at + chunkSize).arrayBuffer()),
      crc,
    );
    progress?.(Math.min(at + chunkSize, file.size));
  }
  cancelled(signal);
  return (crc ^ 0xffffffff) >>> 0;
}

// Whitelist the portable preparation. Account data, room capabilities and live
// scores are never taken from objects stored alongside the song.
function preparation(value: unknown, file?: Blob): PreparedSong {
  if (!record(value) || !record(value.track)) throw invalid();
  const t = value.track;
  if (
    typeof t.id !== "number" ||
    typeof t.title !== "string" ||
    typeof t.artist !== "string" ||
    typeof t.cover !== "string" ||
    !Array.isArray(t.cues) ||
    t.cues.length > 1000 ||
    typeof value.offset !== "number" ||
    typeof value.target !== "number" ||
    typeof value.duration !== "number" ||
    typeof value.savedAt !== "number" ||
    value.schema !== 1 ||
    (value.leadInSeconds !== undefined &&
      typeof value.leadInSeconds !== "number")
  )
    throw invalid();
  const cues = Array.from(t.cues, (cue): Cue => {
    if (
      !record(cue) ||
      typeof cue.startMs !== "number" ||
      typeof cue.endMs !== "number" ||
      typeof cue.text !== "string"
    )
      throw invalid();
    if (
      cue.words !== undefined &&
      cue.words !== null &&
      (!Array.isArray(cue.words) || cue.words.length > 300)
    )
      throw invalid();
    return {
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      ...(Array.isArray(cue.words)
        ? {
            words: Array.from(cue.words, (word) => {
              if (
                !record(word) ||
                typeof word.startMs !== "number" ||
                typeof word.endMs !== "number" ||
                typeof word.text !== "string"
              )
                throw invalid();
              return {
                startMs: word.startMs,
                endMs: word.endMs,
                text: word.text,
              };
            }),
          }
        : {}),
    };
  });
  const track: Track = {
    id: t.id,
    title: t.title,
    artist: t.artist,
    cover: t.cover,
    cues,
    album: typeof t.album === "string" ? t.album : "",
    duration:
      typeof t.duration === "number" &&
      Number.isFinite(t.duration) &&
      t.duration > 0 &&
      t.duration <= 86400
        ? t.duration
        : value.duration,
    link:
      typeof t.link === "string" && t.link.startsWith("https://") ? t.link : "",
    preview:
      typeof t.preview === "string" && t.preview.startsWith("https://")
        ? t.preview
        : "",
    lyricsStatus:
      typeof t.lyricsStatus === "string" && t.lyricsStatus.length <= 80
        ? t.lyricsStatus
        : "imported",
    ...(t.lyricsSync === "word" ||
    t.lyricsSync === "line" ||
    t.lyricsSync === "mixed"
      ? { lyricsSync: t.lyricsSync }
      : {}),
  };
  const song: PreparedSong = {
    schema: 1,
    track,
    offset: value.offset,
    target: value.target,
    duration: value.duration,
    savedAt: value.savedAt,
    ...(typeof value.leadInSeconds === "number"
      ? { leadInSeconds: value.leadInSeconds }
      : {}),
    ...(file ? { file } : {}),
  };
  if (!validPrepared(song)) throw invalid();
  return song;
}

function programme(
  value: unknown,
  songs: PreparedSong[],
): Programme | undefined {
  if (value === undefined) return undefined;
  if (!validProgramme(value)) throw invalid();
  const p = value as Programme;
  if (!p.trackIds.every((id) => songs.some((s) => s.track.id === id)))
    throw invalid();
  return { title: p.title, trackIds: [...p.trackIds] };
}
const validName = (name: unknown): name is string =>
  typeof name === "string" &&
  !!name.trim() &&
  name.length <= 240 &&
  !/[<>:"/\\|?*\u0000-\u001f]/.test(name);
const validMime = (type: unknown): type is string =>
  typeof type === "string" &&
  (type === "" ||
    /^(?:application\/(?:octet-stream|ogg|x-flac)|video\/(?:mp4|webm))$/i.test(
      type,
    ) ||
    /^audio\/[a-z0-9.+-]{1,100}$/i.test(type));
export const packFilename = (title: string) =>
  `${
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\.+$/g, "")
      .trim()
      .slice(0, 100) || "Наш музичний вечір"
  }.khz`;

export async function buildShowPack(
  input: ShowPack,
  signal?: AbortSignal,
  onProgress?: (progress: PackProgress) => void,
): Promise<Blob> {
  cancelled(signal);
  if (
    !input.songs.length ||
    input.songs.length > preparedLimit ||
    new Set(input.songs.map((s) => s.track.id)).size !== input.songs.length
  )
    throw invalid();
  const songs = input.songs.map((s) => preparation(s, s.file));
  const order = programme(input.programme, songs);
  const total = songs.reduce((sum, song) => sum + (song.file?.size ?? 0), 0);
  if (total > packSizeLimit - headerSize - manifestLimit)
    throw new Error("Пакет завеликий. Розділи підготовки на набори до 1 ГБ.");
  const packed: PackedSong[] = [],
    media: Blob[] = [];
  let done = 0;
  for (const [index, song] of songs.entries()) {
    cancelled(signal);
    const { file, ...metadata } = song;
    if (!file) {
      packed.push(metadata);
      continue;
    }
    const name =
      file instanceof File && validName(file.name)
        ? file.name
        : `Аудіо ${song.track.id}`;
    if (!validMime(file.type))
      throw new Error(
        "Тип власного аудіо не підтримується пакетом. Додай аудіофайл і збережи підготовку повторно.",
      );
    const crc = await checksum(file, signal, (bytes) =>
      onProgress?.({
        bytes: done + bytes,
        total,
        song: index + 1,
        songs: songs.length,
      }),
    );
    packed.push({
      ...metadata,
      media: { name, type: file.type, size: file.size, crc32: crc },
    });
    media.push(file);
    done += file.size;
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify({
      format: "khz-show-pack",
      version: 1,
      songs: packed,
      ...(order ? { programme: order } : {}),
    }),
  );
  if (manifest.length > manifestLimit)
    throw new Error("У пакеті забагато тексту. Експортуй менший набір пісень.");
  const header = new Uint8Array(headerSize),
    view = new DataView(header.buffer);
  header.set(magic);
  view.setUint32(8, manifest.length, true);
  view.setUint32(12, crc32(manifest), true);
  cancelled(signal);
  onProgress?.({
    bytes: total,
    total,
    song: songs.length,
    songs: songs.length,
  });
  return new Blob([header, manifest, ...media], {
    type: "application/octet-stream",
  });
}

export async function readShowPack(
  file: Blob,
  signal?: AbortSignal,
  onProgress?: (progress: PackProgress) => void,
): Promise<ShowPack> {
  cancelled(signal);
  if (file.size < headerSize || file.size > packSizeLimit) throw invalid();
  const header = new Uint8Array(await file.slice(0, headerSize).arrayBuffer());
  if (!magic.every((byte, i) => header[i] === byte)) throw invalid();
  const view = new DataView(header.buffer),
    length = view.getUint32(8, true);
  if (!length || length > manifestLimit || headerSize + length > file.size)
    throw invalid();
  const bytes = new Uint8Array(
    await file.slice(headerSize, headerSize + length).arrayBuffer(),
  );
  if (crc32(bytes) !== view.getUint32(12, true)) throw invalid();
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalid();
  }
  if (
    !record(raw) ||
    raw.format !== "khz-show-pack" ||
    raw.version !== 1 ||
    !Array.isArray(raw.songs) ||
    !raw.songs.length ||
    raw.songs.length > preparedLimit
  )
    throw invalid();
  const songs: PreparedSong[] = [];
  const total = file.size - headerSize - length;
  let at = headerSize + length;
  for (const [index, item] of raw.songs.entries()) {
    cancelled(signal);
    if (!record(item)) throw invalid();
    let prepared: PreparedSong;
    if (item.media !== undefined) {
      const m = item.media;
      if (
        !record(m) ||
        !validName(m.name) ||
        !validMime(m.type) ||
        typeof m.size !== "number" ||
        !Number.isSafeInteger(m.size) ||
        m.size <= 0 ||
        m.size > 150 * 1024 * 1024 ||
        at + m.size > file.size ||
        typeof m.crc32 !== "number" ||
        !Number.isInteger(m.crc32) ||
        m.crc32 < 0 ||
        m.crc32 > 0xffffffff
      )
        throw invalid();
      const audio = new File([file.slice(at, at + m.size)], m.name, {
        type: m.type,
      });
      prepared = preparation(item, audio);
      const start = at - headerSize - length;
      const crc = await checksum(audio, signal, (bytes) =>
        onProgress?.({
          bytes: start + bytes,
          total,
          song: index + 1,
          songs: (raw.songs as unknown[]).length,
        }),
      );
      if (crc !== m.crc32) throw invalid();
      at += m.size;
    } else prepared = preparation(item);
    songs.push(prepared);
  }
  if (
    at !== file.size ||
    new Set(songs.map((s) => s.track.id)).size !== songs.length
  )
    throw invalid();
  cancelled(signal);
  return { songs, programme: programme(raw.programme, songs) };
}
